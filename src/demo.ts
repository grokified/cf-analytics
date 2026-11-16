// Dev-only fixture (served when the URL has ?demo). Never reaches the production bundle.
import type {
  Analytics,
  Facet,
  HistogramBucket,
  LogRange,
  LogsPage,
  Me,
  Point,
  Range,
  RequestLog,
  Row,
  RuntimeLog,
  Site,
} from '../shared/api'
import { ApiRequestError } from '@/lib/api'

const me: Me = { accounts: [{ id: 'acc1', name: 'Acme Inc' }] }
const hosts = ['acme.dev', 'docs.acme.dev', 'shop.acme.dev', 'blog.example.com', 'status.example.org']
const sites: Site[] = hosts.map((host, i) => ({
  accountId: 'acc1',
  accountName: me.accounts[0].name,
  siteTag: `tag${i + 1}`,
  host,
  zoneTag: i === 4 ? null : `zone${i + 1}`,
}))

const CFG: Record<Range, { n: number; hour: boolean }> = {
  '24h': { n: 25, hour: true },
  '7d': { n: 8, hour: false },
  '30d': { n: 31, hour: false },
  '90d': { n: 91, hour: false },
}

function rng(seed: string) {
  let a = [...seed].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function rows(rand: () => number, keys: string[], decay: number, totals: { visits: number; pageViews: number }): Row[] {
  const w = keys.map((_, i) => decay ** i * (0.85 + rand() * 0.3))
  const sum = w.reduce((a, b) => a + b, 0)
  return keys.map((key, i) => {
    const visits = Math.max(1, Math.round((totals.visits * w[i]) / sum))
    return { key, visits, pageViews: Math.round(visits * (totals.pageViews / totals.visits) * (0.9 + rand() * 0.25)) }
  })
}

function analytics(q: URLSearchParams): Analytics {
  const range = (q.get('range') ?? '7d') as Range
  const site = q.get('site') ?? 'all'
  const { n, hour } = CFG[range]
  const rand = rng(site + range)
  const siteScale = site === 'all' ? 3.4 : 0.6 + (Number(site.replace('tag', '')) % 5) * 0.35
  const now = new Date()
  const step = hour ? 3600e3 : 86400e3
  const cur = Math.floor(now.getTime() / step) * step
  const progress = hour ? now.getUTCMinutes() / 60 : (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440
  const dow = [0.7, 1, 1.1, 1.15, 1.05, 0.95, 0.65]

  const series: Point[] = Array.from({ length: n }, (_, i) => {
    const d = new Date(cur - (n - 1 - i) * step)
    const wave = hour
      ? 0.55 + 0.45 * Math.sin(((d.getUTCHours() - 8) / 24) * Math.PI * 2)
      : dow[d.getUTCDay()] * (1 + 0.15 * Math.sin(i / 4))
    const base = (hour ? 7 : 42) * siteScale * wave * (0.85 + rand() * 0.3)
    const visits = Math.round(i === n - 1 ? base * Math.max(progress, 0.15) : base)
    const iso = d.toISOString()
    return {
      t: hour ? `${iso.slice(0, 13)}:00:00Z` : iso.slice(0, 10),
      visits,
      pageViews: Math.round(visits * (1.4 + rand() * 0.5)),
    }
  })

  const totals = series.reduce(
    (a, p) => ({ visits: a.visits + p.visits, pageViews: a.pageViews + p.pageViews }),
    { visits: 0, pageViews: 0 },
  )
  const host = sites.find((s) => s.siteTag === site)?.host ?? 'example.com'
  const R = (keys: string[], decay: number) => rows(rand, keys, decay, totals)

  return {
    range,
    granularity: hour ? 'hour' : 'day',
    from: new Date(cur - (n - 1) * step).toISOString(),
    to: now.toISOString(),
    totals,
    previous: { visits: Math.round(totals.visits / 1.46), pageViews: Math.round(totals.pageViews / 0.86) },
    online: Math.floor(rand() * 6),
    series,
    pages: R(
      ['/', '/pricing', '/blog', '/blog/launch-week', '/docs', '/login', '/signup', '/about', '/contact', '/features', '/changelog', '/blog/best-ai-note-takers', '/terms', '/privacy', '/dashboard', '/docs/api', '/docs/getting-started', '/blog/launch-notes', '/careers', '/status'],
      0.78,
    ),
    hostnames: R([host, `www.${host}`, `app.${host}`], 0.35),
    referrers: R(['www.google.com', 't.co', 'www.reddit.com', 'news.ycombinator.com', 'github.com', 'www.bing.com'], 0.62),
    countries: R(['GB', 'US', 'PK', 'BR', 'IN', 'DE', 'SG', 'NL', 'FR', 'CA'], 0.7),
    devices: R(['desktop', 'mobile', 'tablet'], 0.22),
    browsers: R(['Chrome', 'MobileSafari', 'Safari', 'ChromeMobile', 'Firefox', 'Edge'], 0.5),
    os: R(['Windows', 'iOS', 'Mac', 'Android', 'Linux'], 0.5),
  }
}

export async function handle(path: string): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 250))
  const u = new URL(path, location.origin)
  if (u.pathname === '/api/me') return me
  if (u.pathname === '/api/sites') return sites
  if (u.pathname === '/api/analytics') return analytics(u.searchParams)
  if (u.pathname === '/api/logs/requests') return logs('requests', u.searchParams)
  if (u.pathname === '/api/logs/runtime') return logs('runtime', u.searchParams)
}

// ---------------------------------------------------------------------------
// Logs. Events live on a fixed time grid seeded per slot, so ids stay stable across polls and
// new rows appear as time moves on ("Live"). `?demo=403` makes both log endpoints answer 403.

const SECS: Record<LogRange, number> = { '30m': 1800, '1h': 3600, '6h': 21600, '24h': 86400, '3d': 259200, '7d': 604800 }
const pick = <T,>(rand: () => number, items: [T, number][]): T => {
  let r = rand() * items.reduce((a, [, w]) => a + w, 0)
  for (const [v, w] of items) if ((r -= w) < 0) return v
  return items[0][0]
}
const hex = (rand: () => number, n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('')

const PATHS: [string, number][] = [
  ['/', 30],
  ['/api/ingest', 22],
  ['/pricing', 8],
  ['/docs', 6],
  ['/docs/getting-started', 4],
  ['/blog/launch-week', 3],
  ['/login', 3],
  ['/_next/static/chunks/main-4f2a9c1d.js', 8],
  ['/_next/static/css/app-8b31e0.css', 4],
  ['/favicon.ico', 3],
  ['/robots.txt', 1],
  ['/wp-login.php', 1],
]
const UAS: [string, string, string, string, string][] = [
  ['Chrome', 'desktop', 'Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', ''],
  ['Safari', 'desktop', 'Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', ''],
  ['MobileSafari', 'mobile', 'iOS', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', ''],
  ['ChromeMobile', 'mobile', 'Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', ''],
  ['Firefox', 'desktop', 'Linux', 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0', ''],
  ['Googlebot', 'desktop', 'Linux', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Search Engine Crawler'],
]
const ASNS: [string, string][] = [['20978', 'TT Mobile Networks'], ['5089', 'Virgin Media'], ['7922', 'Comcast Cable'], ['16509', 'Amazon.com'], ['17557', 'Pakistan Telecom']]

function requestEvent(slot: number, i: number): RequestLog {
  const rand = rng(`r${slot}.${i}`)
  const path = pick(rand, PATHS)
  const post = path === '/api/ingest'
  const status = path === '/wp-login.php' ? 404 : pick(rand, [[200, 80], [304, 7], [404, 4], [499, 2], [500, 2], [502, 1]])
  const [browser, device, os, userAgent, botCategory] = pick(rand, UAS.map((u, k) => [u, k === 5 ? 1 : 6 - k] as [(typeof UAS)[number], number]))
  const [asn, asnName] = ASNS[Math.floor(rand() * ASNS.length)]
  const static_ = path.startsWith('/_next') || path === '/favicon.ico'
  const cache = static_ ? pick(rand, [['hit', 8], ['miss', 1], ['expired', 1]]) : post || status >= 500 ? 'dynamic' : pick(rand, [['dynamic', 5], ['hit', 3], ['revalidated', 1]])
  const origin = cache === 'hit' ? 0 : status === 502 ? 502 : status
  return {
    id: `${hex(rand, 16)}-${pick(rand, [['LHR', 5], ['MAN', 2], ['FRA', 2], ['IAD', 2], ['KHI', 1]])}`,
    time: new Date(slot * 1000).toISOString().slice(0, 19) + 'Z',
    method: post ? 'POST' : pick(rand, [['GET', 95], ['HEAD', 3], ['OPTIONS', 2]]),
    host: pick(rand, [['acme.dev', 7], ['docs.acme.dev', 3]]),
    path,
    query: path === '/' && rand() < 0.2 ? '?utm_source=hn' : path === '/pricing' && rand() < 0.3 ? '?plan=pro' : '',
    status,
    originStatus: origin,
    originMs: origin ? Math.round(20 + rand() * (status >= 500 ? 2800 : 260)) : 0,
    cache,
    contentType: static_ ? (path.endsWith('.css') ? 'css' : 'js') : post ? 'json' : 'html',
    protocol: pick(rand, [['HTTP/3', 5], ['HTTP/2', 4], ['HTTP/1.1', 1]]),
    country: pick(rand, [['GB', 5], ['US', 4], ['PK', 2], ['DE', 2], ['BR', 1], ['IN', 1], ['SG', 1]]),
    device,
    browser,
    os,
    userAgent,
    asn,
    asnName,
    source: rand() < 0.15 ? 'edgeWorkerFetch' : 'eyeball',
    securityAction: path === '/wp-login.php' ? 'block' : 'unknown',
    securitySource: path === '/wp-login.php' ? 'firewallManaged' : 'unknown',
    botCategory,
  }
}

const TRIGGERS: Record<string, [string, string]> = {
  'acme-api': ['POST /api/ingest', 'fetch'],
  'acme-cron': ['cron */5 * * * *', 'scheduled'],
  'acme-email': ['queue email-outbox', 'queue'],
}
const MSGS: Record<string, Record<string, string[]>> = {
  'acme-api': {
    info: ['ingest accepted batch=42 events=318', 'session resolved user=u_9f2c', 'cache warm key=pricing:v3'],
    log: ['request received', 'rate limit ok remaining=94'],
    debug: ['parsed payload in 2ms', 'kv.get sessions:u_9f2c hit'],
    warn: ['slow D1 query took 812ms (SELECT * FROM events WHERE site = ?)', 'retrying upstream fetch attempt=2'],
    error: [
      "TypeError: Cannot read properties of undefined (reading 'id')\n    at handleIngest (index.js:128:22)\n    at async Object.fetch (index.js:54:14)\n    at async Object.fetch (index.js:19:10)",
      'Error: D1_ERROR: database is locked\n    at D1Database.prepare (cloudflare:d1:41:9)\n    at flushBatch (index.js:204:17)',
    ],
  },
  'acme-cron': {
    info: ['rollup finished sites=5 duration=1.4s', 'purged 1204 expired sessions'],
    log: ['cron tick'],
    debug: ['lock acquired rollup:5m'],
    warn: ['rollup took longer than expected (4.9s)'],
    error: ['Error: upstream 502 from api.cloudflare.com\n    at fetchAnalytics (cron.js:77:11)\n    at async scheduled (cron.js:31:5)'],
  },
  'acme-email': {
    info: ['sent welcome email to u_3a91', 'digest queued recipients=128'],
    log: ['dequeued message id=m_81f2'],
    debug: ['template rendered in 4ms'],
    warn: ['bounce from provider code=550 recipient=u_77b1'],
    error: ['Error: SMTP 421 try again later\n    at send (email.js:63:13)\n    at async queue (email.js:22:7)'],
  },
}

function runtimeEvent(slot: number, i: number): RuntimeLog {
  const rand = rng(`w${slot}.${i}`)
  const worker = pick(rand, [['acme-api', 6], ['acme-cron', 2], ['acme-email', 2]]) as string
  const level = pick(rand, [['info', 55], ['log', 15], ['debug', 8], ['warn', 12], ['error', 10]]) as string
  const msgs = MSGS[worker][level]
  const [trigger, eventType] = TRIGGERS[worker]
  const t = new Date(slot * 1000 + Math.floor(rand() * 1000))
  const wallMs = Math.round(2 + rand() * 90)
  const rayId = eventType === 'fetch' ? `${hex(rand, 16)}-LHR` : ''
  const requestId = `req_${hex(rand, 12)}`
  const message = msgs[Math.floor(rand() * msgs.length)]
  const outcome = level === 'error' ? 'exception' : 'ok'
  return {
    id: `01J${hex(rand, 23).toUpperCase()}`,
    time: t.toISOString(),
    level,
    message,
    worker,
    trigger,
    rayId,
    requestId,
    eventType,
    outcome,
    wallMs,
    cpuMs: Math.round(wallMs * 0.2),
    raw: { $metadata: { id: 'see id', service: worker, level, trigger, requestId }, message, outcome, wallMs },
  }
}

function logs(view: 'requests' | 'runtime', u: URLSearchParams): LogsPage<RequestLog | RuntimeLog> {
  if (new URLSearchParams(location.search).get('demo') === '403') {
    throw new ApiRequestError(
      403,
      view === 'requests'
        ? 'Token is missing Zone > Analytics > Read for this zone.'
        : 'Token is missing Account > Workers Observability > Edit.',
    )
  }
  const range = (u.get('range') ?? '1h') as LogRange
  const span = SECS[range]
  const step = Math.max(2, Math.ceil(span / 1500))
  const nowS = Math.floor(Date.now() / 1000)
  const fromS = nowS - span
  const q = (u.get('q') ?? '').toLowerCase()
  const list = (k: string) => u.get(k)?.split(',').filter(Boolean) ?? []
  const requests = view === 'requests'
  const keys = requests ? ['status', 'method', 'cache', 'host'] : ['level', 'worker', 'outcome']
  const val = (e: RequestLog | RuntimeLog, k: string) =>
    k === 'status' ? `${Math.floor((e as RequestLog).status / 100)}xx` : String((e as unknown as Record<string, unknown>)[k])

  let all: (RequestLog | RuntimeLog)[] = []
  for (let slot = Math.ceil(fromS / step) * step; slot <= nowS; slot += step) {
    const n = Math.floor(rng(`n${view}${slot}`)() * 3)
    for (let i = 0; i < n; i++) all.push(requests ? requestEvent(slot, i) : runtimeEvent(slot, i))
  }
  all.reverse()
  const visitors = u.get('source') !== 'all'
  all = all.filter((e) => {
    if (requests && visitors && (e as RequestLog).source !== 'eyeball') return false
    if (!q) return true
    return requests ? (e as RequestLog).path.toLowerCase().includes(q) : (e as RuntimeLog).message.toLowerCase().includes(q)
  })
  const facets: Record<string, Facet[]> = {}
  for (const k of keys) {
    const m = new Map<string, number>()
    for (const e of all) m.set(val(e, k), (m.get(val(e, k)) ?? 0) + 1)
    facets[k] = [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
  }
  const rows = all.filter((e) => keys.every((k) => !list(k).length || list(k).includes(val(e, k))))

  const bucketMs = (span * 1000) / 60
  const t0 = fromS * 1000
  const histogram: HistogramBucket[] = Array.from({ length: 60 }, (_, i) => ({
    t: new Date(t0 + i * bucketMs).toISOString(),
    ok: 0,
    warn: 0,
    error: 0,
  }))
  for (const e of rows) {
    const b = histogram[Math.min(59, Math.max(0, Math.floor((new Date(e.time).getTime() - t0) / bucketMs)))]
    const sev = requests
      ? (e as RequestLog).status >= 500 ? 'error' : (e as RequestLog).status >= 400 ? 'warn' : 'ok'
      : (e as RuntimeLog).level === 'error' ? 'error' : (e as RuntimeLog).level === 'warn' ? 'warn' : 'ok'
    b[sev]++
  }

  const before = u.get('before')
  const page = before ? rows.filter((e) => e.time <= before) : rows
  return {
    from: new Date(t0).toISOString(),
    to: new Date(nowS * 1000).toISOString(),
    rows: page.slice(0, 100),
    histogram,
    facets,
    nextBefore: page.length > 100 ? page[100].time : null,
  }
}
