import type { Account, Analytics, Range, Row, Site } from '../shared/api.ts'

const API = 'https://api.cloudflare.com/client/v4'

export type CfResult = { ok: boolean; status: number; body: any }

/** GET against the Cloudflare REST API. Never throws on HTTP errors; the token is never logged. */
export async function cfGet(token: string, path: string): Promise<CfResult> {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } })
  const body: any = await res.json().catch(() => null)
  return { ok: res.ok && body?.success === true, status: res.status, body }
}

export const cfError = (r: CfResult) => r.body?.errors?.[0]?.message as string | undefined

export const toAccounts = (r: CfResult): Account[] =>
  (r.body.result as any[]).map((a) => ({ id: a.id, name: a.name }))

export async function listSites(token: string, accounts: Account[]): Promise<Site[]> {
  const perAccount = await Promise.all(
    accounts.map(async (acc) => {
      const out: Site[] = []
      for (let page = 1, pages = 1; page <= pages; page++) {
        const r = await cfGet(token, `/accounts/${acc.id}/rum/site_info/list?per_page=100&page=${page}`)
        if (!r.ok) throw new Error(cfError(r) ?? 'Cloudflare request failed')
        pages = r.body.result_info?.total_pages ?? 1
        for (const x of r.body.result as any[]) {
          out.push({
            accountId: acc.id,
            accountName: acc.name,
            siteTag: x.site_tag,
            host: x.host || x.ruleset?.zone_name || x.site_tag,
            zoneTag: x.ruleset?.zone_tag ?? null,
          })
        }
      }
      return out
    }),
  )
  return perAccount.flat().sort((a, b) => a.host.localeCompare(b.host))
}

// ---- analytics ----

const HOUR = 3600_000
const DAY = 24 * HOUR
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

export type BuiltQuery = {
  query: string
  variables: Record<string, unknown>
  buckets: string[]
  granularity: 'hour' | 'day'
  from: string
  to: string
}

const FILTER_TYPE = 'AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!'
const AGG = 'count sum { visits }'

export function buildAnalyticsQuery(accountId: string, site: string, range: Range, now: Date): BuiltQuery {
  const granularity = range === '24h' ? 'hour' : 'day'
  const n = range === '24h' ? 24 : parseInt(range)
  const step = granularity === 'hour' ? HOUR : DAY
  const nowMs = now.getTime()
  const fromMs = granularity === 'hour' ? Math.floor(nowMs / HOUR) * HOUR - 23 * HOUR : Math.floor(nowMs / DAY) * DAY - (n - 1) * DAY
  const prevFromMs = fromMs - n * step

  const buckets = Array.from({ length: n }, (_, i) => {
    const s = iso(fromMs + i * step)
    return granularity === 'hour' ? s : s.slice(0, 10)
  })

  const base = (geq: number, extra: object[] = []) => ({
    AND: [
      { bot: 0 },
      ...(site === 'all' ? [] : [{ siteTag: site }]),
      { datetime_geq: iso(geq) },
      ...extra,
    ],
  })
  const f = base(fromMs, [{ datetime_leq: iso(nowMs) }])
  const prev = base(prevFromMs, [{ datetime_lt: iso(fromMs) }])
  const online = base(nowMs - 5 * 60_000, [{ datetime_leq: iso(nowMs) }])
  const refs = { AND: [...f.AND, { refererHost_neq: '' }] }

  const dim = granularity === 'hour' ? 'datetimeHour' : 'date'
  const group = (alias: string, filter: string, field: string, order = 'count_DESC') =>
    `${alias}: rumPageloadEventsAdaptiveGroups(filter: ${filter}, limit: 100, orderBy: [${order}]) { ${AGG} dimensions { ${field} } }`

  const query = `query ($a: String!, $f: ${FILTER_TYPE}, $p: ${FILTER_TYPE}, $o: ${FILTER_TYPE}, $r: ${FILTER_TYPE}) {
  viewer { accounts(filter: { accountTag: $a }) {
    total: rumPageloadEventsAdaptiveGroups(filter: $f, limit: 1) { ${AGG} }
    prev: rumPageloadEventsAdaptiveGroups(filter: $p, limit: 1) { ${AGG} }
    online: rumPageloadEventsAdaptiveGroups(filter: $o, limit: 1) { ${AGG} }
    series: rumPageloadEventsAdaptiveGroups(filter: $f, limit: 200, orderBy: [${dim}_ASC]) { ${AGG} dimensions { ${dim} } }
    ${group('pages', '$f', 'requestPath')}
    ${group('hostnames', '$f', 'requestHost')}
    ${group('referrers', '$r', 'refererHost', 'sum_visits_DESC')}
    ${group('countries', '$f', 'countryName')}
    ${group('devices', '$f', 'deviceType')}
    ${group('browsers', '$f', 'userAgentBrowser')}
    ${group('os', '$f', 'userAgentOS')}
  } }
}`

  return {
    query,
    variables: { a: accountId, f, p: prev, o: online, r: refs },
    buckets,
    granularity,
    from: iso(fromMs),
    to: iso(nowMs),
  }
}

type Agg = { count?: number; sum?: { visits?: number }; dimensions?: Record<string, string> }

export function shapeAnalytics(data: any, built: BuiltQuery, range: Range): Analytics {
  const acc = data?.viewer?.accounts?.[0] ?? {}
  const totals = (a?: Agg[]) => ({ visits: a?.[0]?.sum?.visits ?? 0, pageViews: a?.[0]?.count ?? 0 })
  const rows = (a: Agg[] | undefined, field: string): Row[] =>
    (a ?? []).map((x) => ({ key: x.dimensions?.[field] ?? '', visits: x.sum?.visits ?? 0, pageViews: x.count ?? 0 }))

  const dim = built.granularity === 'hour' ? 'datetimeHour' : 'date'
  const byBucket = new Map(rows(acc.series, dim).map((r) => [r.key, r]))

  return {
    range,
    granularity: built.granularity,
    from: built.from,
    to: built.to,
    totals: totals(acc.total),
    previous: totals(acc.prev),
    online: acc.online?.[0]?.sum?.visits ?? 0,
    series: built.buckets.map((t) => ({
      t,
      visits: byBucket.get(t)?.visits ?? 0,
      pageViews: byBucket.get(t)?.pageViews ?? 0,
    })),
    pages: rows(acc.pages, 'requestPath'),
    hostnames: rows(acc.hostnames, 'requestHost'),
    referrers: rows(acc.referrers, 'refererHost').filter((r) => r.key !== '' && r.visits > 0),
    countries: rows(acc.countries, 'countryName'),
    devices: rows(acc.devices, 'deviceType'),
    browsers: rows(acc.browsers, 'userAgentBrowser'),
    os: rows(acc.os, 'userAgentOS'),
  }
}

/** Run the analytics query; throws Error with a safe message on GraphQL failure. */
export async function fetchAnalytics(token: string, accountId: string, site: string, range: Range): Promise<Analytics> {
  const built = buildAnalyticsQuery(accountId, site, range, new Date())
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: built.query, variables: built.variables }),
  })
  const body: any = await res.json().catch(() => null)
  const msg: string | undefined = body?.errors?.[0]?.message
  if (msg) {
    throw new Error(/auth|permission|access|forbidden/i.test(msg) ? 'Token needs Account Analytics: Read' : msg)
  }
  if (!res.ok || !body?.data) throw new Error('Cloudflare analytics request failed')
  return shapeAnalytics(body.data, built, range)
}
