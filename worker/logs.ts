import { LOG_RANGES } from '../shared/api.ts'
import type { Facet, HistogramBucket, LogRange, LogsPage, RequestLog, RuntimeLog } from '../shared/api.ts'

const API = 'https://api.cloudflare.com/client/v4'
const PAGE = 100
const MIN = 60_000
const RANGE_MS: Record<LogRange, number> = {
  '30m': 30 * MIN,
  '1h': 60 * MIN,
  '6h': 6 * 60 * MIN,
  '24h': 24 * 60 * MIN,
  '3d': 3 * 24 * 60 * MIN,
  '7d': 7 * 24 * 60 * MIN,
}

/** Thrown by the handlers; index.ts turns it into a JSON error response. */
export class LogError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const ITEM = /^[A-Za-z0-9._:/\- ]{1,100}$/
const HEX32 = /^[0-9a-f]{32}$/
const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx']

type Common = { range: LogRange; q: string; before: number | null; fromMs: number; nowMs: number }

function list(url: URL, name: string): string[] {
  const raw = url.searchParams.get(name)
  if (!raw) return []
  const items = raw.split(',')
  if (!items.every((i) => ITEM.test(i))) throw new LogError(`Invalid ${name}`, 400)
  return items
}

function parseCommon(url: URL, now: Date): Common {
  const range = url.searchParams.get('range') ?? ''
  if (!LOG_RANGES.includes(range as LogRange)) throw new LogError('Invalid range', 400)
  const q = url.searchParams.get('q') ?? ''
  if (q.length > 200) throw new LogError('q too long', 400)
  const nowMs = now.getTime()
  const fromMs = nowMs - RANGE_MS[range as LogRange]
  const b = url.searchParams.get('before')
  let before: number | null = null
  if (b !== null) {
    before = Date.parse(b)
    if (!Number.isFinite(before) || before < fromMs || before > nowMs) throw new LogError('Invalid before', 400)
  }
  return { range: range as LogRange, q, before, fromMs, nowMs }
}

// ---- request logs (zone GraphQL) ----

type Bucket = { dim: string; step: number }
const bucketFor = (range: LogRange): Bucket =>
  range === '30m' || range === '1h'
    ? { dim: 'datetimeMinute', step: MIN }
    : range === '6h'
      ? { dim: 'datetimeFiveMinutes', step: 5 * MIN }
      : range === '24h'
        ? { dim: 'datetimeFifteenMinutes', step: 15 * MIN }
        : { dim: 'datetimeHour', step: 60 * MIN }

const ROW_FIELDS =
  'datetime rayName clientRequestHTTPMethodName clientRequestHTTPHost clientRequestPath clientRequestQuery ' +
  'edgeResponseStatus originResponseStatus cacheStatus originResponseDurationMs clientCountryName userAgent ' +
  'clientRequestHTTPProtocol requestSource securityAction securitySource edgeResponseContentTypeName ' +
  'clientDeviceType userAgentBrowser userAgentOS clientAsn clientASNDescription verifiedBotCategory'

export type BuiltRequests = {
  query: string
  variables: Record<string, unknown>
  bucket: Bucket
  buckets: string[]
  from: string
  to: string
}

export function buildRequestsQuery(zone: string, url: URL, now: Date): BuiltRequests {
  const c = parseCommon(url, now)
  const status = list(url, 'status')
  if (!status.every((s) => STATUS_CLASSES.includes(s))) throw new LogError('Invalid status', 400)
  const method = list(url, 'method')
  const cache = list(url, 'cache')
  const host = list(url, 'host')
  const source = url.searchParams.get('source') ?? 'visitors'
  if (source !== 'visitors' && source !== 'all') throw new LogError('Invalid source', 400)

  const base = [
    { datetime_geq: iso(c.fromMs) },
    { datetime_leq: iso(c.nowMs) },
    ...(source === 'visitors' ? [{ requestSource: 'eyeball' }] : []),
    ...(c.q ? [{ clientRequestPath_like: `%${c.q}%` }] : []),
  ]
  const checks = [
    ...(status.length
      ? [{ OR: status.map((s) => ({ AND: [{ edgeResponseStatus_geq: +s[0] * 100 }, { edgeResponseStatus_lt: (+s[0] + 1) * 100 }] })) }]
      : []),
    ...(method.length ? [{ clientRequestHTTPMethodName_in: method }] : []),
    ...(cache.length ? [{ cacheStatus_in: cache }] : []),
    ...(host.length ? [{ clientRequestHTTPHost_in: host }] : []),
  ]
  const all = { AND: [...base, ...checks] }
  const rows = { AND: [...all.AND, ...(c.before !== null ? [{ datetime_leq: iso(c.before) }] : [])] }

  const bucket = bucketFor(c.range)
  const G = 'ZoneHttpRequestsAdaptiveGroupsFilter_InputObject'
  const facet = (alias: string, field: string) =>
    `${alias}: httpRequestsAdaptiveGroups(filter: $bf, limit: 100, orderBy: [count_DESC]) { count dimensions { ${field} } }`
  const query = `query ($z: String!, $rf: ZoneHttpRequestsAdaptiveFilter_InputObject, $hf: ${G}, $bf: ${G}) {
  viewer { zones(filter: { zoneTag: $z }) {
    rows: httpRequestsAdaptive(filter: $rf, limit: ${PAGE}, orderBy: [datetime_DESC]) { ${ROW_FIELDS} }
    hist: httpRequestsAdaptiveGroups(filter: $hf, limit: 10000) { count dimensions { ${bucket.dim} edgeResponseStatus } }
    ${facet('status', 'edgeResponseStatus')}
    ${facet('method', 'clientRequestHTTPMethodName')}
    ${facet('cache', 'cacheStatus')}
    ${facet('host', 'clientRequestHTTPHost')}
  } }
}`

  return {
    query,
    variables: { z: zone, rf: rows, hf: all, bf: { AND: base } },
    bucket,
    buckets: bucketStarts(c.fromMs, c.nowMs, bucket.step),
    from: iso(c.fromMs),
    to: iso(c.nowMs),
  }
}

const bucketStarts = (fromMs: number, toMs: number, step: number) => {
  const out: string[] = []
  for (let t = Math.floor(fromMs / step) * step; t <= toMs; t += step) out.push(iso(t))
  return out
}

const topFacet = (rows: any[] | undefined, field: string): Facet[] =>
  (rows ?? [])
    .map((r) => ({ key: String(r.dimensions?.[field] ?? ''), count: r.count ?? 0 }))
    .filter((f) => f.key !== '')
    .slice(0, 20)

export function shapeRequests(data: any, built: BuiltRequests): LogsPage<RequestLog> {
  const z = data?.viewer?.zones?.[0] ?? {}
  const rows: RequestLog[] = (z.rows ?? []).map((r: any) => ({
    id: r.rayName,
    time: r.datetime,
    method: r.clientRequestHTTPMethodName,
    host: r.clientRequestHTTPHost,
    path: r.clientRequestPath,
    query: !r.clientRequestQuery ? '' : r.clientRequestQuery.startsWith('?') ? r.clientRequestQuery : `?${r.clientRequestQuery}`,
    status: r.edgeResponseStatus,
    originStatus: r.originResponseStatus ?? 0,
    originMs: r.originResponseDurationMs ?? 0,
    cache: r.cacheStatus,
    contentType: r.edgeResponseContentTypeName,
    protocol: r.clientRequestHTTPProtocol,
    country: r.clientCountryName,
    device: r.clientDeviceType,
    browser: r.userAgentBrowser,
    os: r.userAgentOS,
    userAgent: r.userAgent,
    asn: String(r.clientAsn ?? ''),
    asnName: r.clientASNDescription ?? '',
    source: r.requestSource,
    securityAction: r.securityAction,
    securitySource: r.securitySource,
    botCategory: r.verifiedBotCategory ?? '',
  }))

  const hist = new Map<string, HistogramBucket>(built.buckets.map((t) => [t, { t, ok: 0, warn: 0, error: 0 }]))
  for (const g of z.hist ?? []) {
    const b = hist.get(iso(Date.parse(g.dimensions[built.bucket.dim])))
    if (!b) continue
    const s = g.dimensions.edgeResponseStatus
    b[s >= 500 ? 'error' : s >= 400 ? 'warn' : 'ok'] += g.count
  }

  const classes = new Map<string, number>()
  for (const g of z.status ?? []) {
    const s = g.dimensions?.edgeResponseStatus
    if (s >= 100) classes.set(`${Math.floor(s / 100)}xx`, (classes.get(`${Math.floor(s / 100)}xx`) ?? 0) + g.count)
  }

  return {
    from: built.from,
    to: built.to,
    rows,
    histogram: [...hist.values()],
    facets: {
      status: [...classes].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
      method: topFacet(z.method, 'clientRequestHTTPMethodName'),
      cache: topFacet(z.cache, 'cacheStatus'),
      host: topFacet(z.host, 'clientRequestHTTPHost'),
    },
    nextBefore: rows.length === PAGE ? rows[PAGE - 1].time : null,
  }
}

export async function requestLogs(token: string, url: URL): Promise<LogsPage<RequestLog>> {
  const zone = url.searchParams.get('zone') ?? ''
  if (!HEX32.test(zone)) throw new LogError('Invalid zone', 400)
  const built = buildRequestsQuery(zone, url, new Date())
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: built.query, variables: built.variables }),
  })
  const body: any = await res.json().catch(() => null)
  const msg: string | undefined = body?.errors?.[0]?.message
  if (msg) {
    if (/access|authz|does not have/i.test(msg)) throw new LogError('Token needs Zone › Analytics › Read for this site', 403)
    throw new LogError(msg, 502)
  }
  if (!res.ok || !body?.data) throw new LogError('Cloudflare logs request failed', 502)
  return shapeRequests(body.data, built)
}

// ---- runtime logs (Workers Observability) ----

const LEVEL_KEY = '$metadata.level'
const SERVICE_KEY = '$metadata.service'
const OUTCOME_KEY = '$workers.outcome'

export type BuiltRuntime = { from: number; now: number; rows: object; hist: object; facets: Record<string, object> }

export function buildRuntimeQueries(url: URL, now: Date): BuiltRuntime {
  const c = parseCommon(url, now)
  const level = list(url, 'level')
  const worker = list(url, 'worker')
  const outcome = list(url, 'outcome')
  const needle = c.q ? { needle: { value: c.q, matchCase: false } } : {}
  const inFilter = (key: string, items: string[]) => ({ key, operation: 'in', type: 'string', value: items.join(',') })
  const checks = [
    ...(level.length ? [inFilter(LEVEL_KEY, level)] : []),
    ...(worker.length ? [inFilter(SERVICE_KEY, worker)] : []),
    ...(outcome.length ? [inFilter(OUTCOME_KEY, outcome)] : []),
  ]
  const calc = (filters: object[], key: string | null, limit: number) => ({
    queryId: 'logs',
    view: 'calculations',
    timeframe: { from: c.fromMs, to: c.nowMs },
    limit,
    ...(key ? { ignoreSeries: true } : {}),
    parameters: {
      filters,
      ...needle,
      calculations: [{ operator: 'count' }],
      groupBys: [{ type: 'string', value: key ?? LEVEL_KEY }],
    },
  })

  return {
    from: c.fromMs,
    now: c.nowMs,
    rows: {
      queryId: 'logs',
      view: 'events',
      timeframe: { from: c.fromMs, to: c.before ?? c.nowMs },
      limit: PAGE,
      parameters: { filters: checks, ...needle },
    },
    // ponytail: no `granularity` (any value yields 1s buckets); Cloudflare picks ~60 buckets, we pass them through.
    hist: calc(checks, null, 2000),
    facets: { level: calc([], LEVEL_KEY, 20), worker: calc([], SERVICE_KEY, 20), outcome: calc([], OUTCOME_KEY, 20) },
  }
}

const levelClass = (l: string): 'ok' | 'warn' | 'error' => (l === 'error' ? 'error' : l === 'warn' ? 'warn' : 'ok')

export function shapeRuntimeRows(res: any): RuntimeLog[] {
  return ((res?.result?.events?.events ?? []) as any[]).map((e) => {
    const { cf: _cf, ...request } = e.$workers?.event?.request ?? {}
    const raw = { ...e, $workers: { ...e.$workers, event: { ...e.$workers?.event, request } } }
    return {
      id: e.$metadata?.id,
      time: new Date(e.timestamp).toISOString(),
      level: e.$metadata?.level ?? 'log',
      message: e.$metadata?.message ?? e.source?.message ?? e.$metadata?.error ?? '',
      worker: e.$metadata?.service ?? e.$workers?.scriptName ?? '',
      trigger: e.$metadata?.trigger ?? '',
      rayId: e.$metadata?.rayId ?? '',
      requestId: e.$metadata?.requestId ?? '',
      eventType: e.$workers?.eventType ?? '',
      outcome: e.$workers?.outcome ?? '',
      wallMs: e.$workers?.wallTimeMs ?? null,
      cpuMs: e.$workers?.cpuTimeMs ?? null,
      raw,
    }
  })
}

export function shapeRuntimeHistogram(res: any): HistogramBucket[] {
  // series[].time is UTC "YYYY-MM-DD HH:mm:ss"; Cloudflare already zero-fills it.
  return ((res?.result?.calculations?.[0]?.series ?? []) as any[]).map((s) => {
    const b: HistogramBucket = { t: iso(Date.parse(`${s.time.replace(' ', 'T')}Z`)), ok: 0, warn: 0, error: 0 }
    for (const d of s.data ?? []) b[levelClass(d.groups?.[0]?.value)] += d.value ?? 0
    return b
  })
}

export const shapeRuntimeFacet = (res: any): Facet[] =>
  ((res?.result?.calculations?.[0]?.aggregates ?? []) as any[])
    .map((a) => ({ key: String(a.groups?.[0]?.value ?? ''), count: a.value ?? 0 }))
    .filter((f) => f.key !== '')
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

async function telemetry(token: string, account: string, body: object): Promise<any> {
  const res = await fetch(`${API}/accounts/${account}/workers/observability/telemetry/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 401 || res.status === 403) {
    throw new LogError('Token needs Account › Workers Observability › Edit to read runtime logs', 403)
  }
  const json: any = await res.json().catch(() => null)
  if (!res.ok || json?.success === false) {
    throw new LogError(json?.errors?.[0]?.message ?? 'Cloudflare runtime logs request failed', 502)
  }
  return json
}

export async function runtimeLogs(token: string, url: URL): Promise<LogsPage<RuntimeLog>> {
  const account = url.searchParams.get('account') ?? ''
  if (!HEX32.test(account)) throw new LogError('Invalid account', 400)
  const b = buildRuntimeQueries(url, new Date())
  const keys = Object.keys(b.facets)
  const [rows, hist, ...facets] = await Promise.all([
    telemetry(token, account, b.rows),
    telemetry(token, account, b.hist),
    ...keys.map((k) => telemetry(token, account, b.facets[k])),
  ])
  const shaped = shapeRuntimeRows(rows)
  return {
    from: iso(b.from),
    to: iso(b.now),
    rows: shaped,
    histogram: shapeRuntimeHistogram(hist),
    facets: Object.fromEntries(keys.map((k, i) => [k, shapeRuntimeFacet(facets[i])])),
    nextBefore: shaped.length === PAGE ? shaped[PAGE - 1].time : null,
  }
}
