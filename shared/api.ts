// Worker <-> SPA contract. Single source of truth; both sides import from here.
//
// Endpoints (same-origin JSON, auth = encrypted HttpOnly session cookie):
//   POST /api/login    body { token }  -> 200 Me | 400/401/403 ApiError   (sets cookie)
//   POST /api/logout                   -> 204                              (clears cookie)
//   GET  /api/me                       -> 200 Me | 401 ApiError
//   GET  /api/sites                    -> 200 Site[] | 401 ApiError
//   GET  /api/analytics?account=<id>&site=<siteTag|"all">&range=<Range>
//                                      -> 200 Analytics | 400/401/502 ApiError

export const RANGES = ['24h', '7d', '30d', '90d'] as const
export type Range = (typeof RANGES)[number]

export type ApiError = { error: string }

export type Account = { id: string; name: string }
export type Me = { accounts: Account[] }

/** One Cloudflare Web Analytics (RUM) site. */
export type Site = {
  accountId: string
  accountName: string
  siteTag: string
  host: string
  /** Cloudflare zone of the site (from the RUM ruleset); null when the site is not proxied. Needed for request logs. */
  zoneTag: string | null
}

/** One breakdown row. Both metrics always present; UI picks which to show/sort by. */
export type Row = { key: string; visits: number; pageViews: number }

/** Time bucket. t = "YYYY-MM-DD" for day buckets, "YYYY-MM-DDTHH:00:00Z" for hour buckets. */
export type Point = { t: string; visits: number; pageViews: number }

export type Totals = { visits: number; pageViews: number }

export type Analytics = {
  range: Range
  granularity: 'hour' | 'day'
  from: string // ISO datetime, inclusive
  to: string // ISO datetime (now)
  totals: Totals
  previous: Totals // same-length window immediately before `from`
  online: number // visits in the last 5 minutes
  series: Point[] // every bucket from..to, zero-filled, ascending; last bucket is still in progress
  pages: Row[] // requestPath
  hostnames: Row[] // requestHost
  referrers: Row[] // refererHost; excludes "" (direct) and rows with 0 visits
  countries: Row[] // countryName = ISO 3166-1 alpha-2, e.g. "GB"
  devices: Row[] // deviceType: "desktop" | "mobile" | "tablet" | ...
  browsers: Row[] // userAgentBrowser, e.g. "Chrome", "MobileSafari", "ChromeMobile"
  os: Row[] // userAgentOS, e.g. "Windows", "iOS", "Android"
}

// ---------------------------------------------------------------------------
// Logs
//
//   GET /api/logs/requests?zone=<zoneTag>&range=<LogRange>[&q=][&status=2xx,5xx][&method=GET,POST]
//                          [&cache=hit,dynamic][&host=a.com][&source=visitors|all][&before=<ISO>]
//        -> 200 LogsPage<RequestLog> | 400/401/403/502 ApiError
//        403 => token lacks Zone > Analytics > Read for that zone.
//   GET /api/logs/runtime?account=<id>&range=<LogRange>[&q=][&level=error,warn][&worker=a,b]
//                         [&outcome=ok,exception][&before=<ISO>]
//        -> 200 LogsPage<RuntimeLog> | 400/401/403/502 ApiError
//        403 => token lacks Account > Workers Observability > Edit (Cloudflare requires Edit to query).
//
// Multi-value filters are comma-separated. `q` = substring search (requests: path; runtime: full-text).
// `before` = cursor for the next (older) page: rows with time <= before. Pages are newest-first,
// 100 rows max; the client de-duplicates by `id` when appending.
// Facet counts ignore the checkbox filters (status/method/cache/host/level/worker/outcome) so they
// stay stable while toggling; they DO respect range, q and source. Rows and histogram respect all.
// ---------------------------------------------------------------------------

export const LOG_RANGES = ['30m', '1h', '6h', '24h', '3d', '7d'] as const
export type LogRange = (typeof LOG_RANGES)[number]

/** One HTTP request through a Cloudflare zone (sampled; GraphQL httpRequestsAdaptive). */
export type RequestLog = {
  id: string // Ray ID
  time: string // ISO, second precision
  method: string
  host: string
  path: string
  query: string // "" or "?a=b"
  status: number // edge response status
  originStatus: number // 0 = not sent to origin
  originMs: number
  cache: string // hit | miss | dynamic | none | expired | revalidated | ...
  contentType: string // json | html | png | ...
  protocol: string // HTTP/1.1 | HTTP/2 | HTTP/3
  country: string // ISO alpha-2
  device: string
  browser: string
  os: string
  userAgent: string
  asn: string
  asnName: string
  source: string // eyeball | edgeWorkerFetch | edgeWorkerCacheAPI | ...
  securityAction: string // "unknown" when none
  securitySource: string
  botCategory: string
}

/** One Workers Logs event (Workers Observability). */
export type RuntimeLog = {
  id: string // $metadata.id
  time: string // ISO with ms
  level: string // log | info | debug | warn | error
  message: string
  worker: string // script name ($metadata.service)
  trigger: string // e.g. "GET /v1/models", cron, queue
  rayId: string
  requestId: string
  eventType: string // fetch | scheduled | queue | ...
  outcome: string // ok | exception | canceled | exceededCpu | ... ("" when unknown)
  wallMs: number | null
  cpuMs: number | null
  raw: unknown // the event JSON (large request.cf blobs removed) for the details sheet
}

/** Histogram bucket. ok/warn/error = requests: <400 / 4xx / 5xx; runtime: info,log,debug / warn / error. */
export type HistogramBucket = { t: string; ok: number; warn: number; error: number }
export type Facet = { key: string; count: number }

export type LogsPage<T> = {
  from: string // ISO
  to: string // ISO
  rows: T[]
  histogram: HistogramBucket[] // zero-filled, ascending
  facets: Record<string, Facet[]> // requests: status ("2xx".."5xx"), method, cache, host; runtime: level, worker, outcome
  nextBefore: string | null // pass as `before` for older rows; null = no more
}

// ---------------------------------------------------------------------------
// Live visitors (our own script + one Durable Object per site host)
//
//   GET /api/live/tickets?account=<id>&site=<siteTag|all> -> LiveTicket[]  (session required)
//   WS  /api/live?host=<host>&t=<ticket>  -> pushes LiveSnapshot on connect and on every change
//   WS  /api/rt?site=<host>&p=<path>      -> visitor socket opened by /rt.js; Origin must be <host> or a subdomain
// A host only accepts visitors after someone with access to it has opened the dashboard once.
// ---------------------------------------------------------------------------

export type LiveTicket = { host: string; ticket: string }

export type LiveSnapshot = {
  online: number // open, visible tabs running /rt.js
  pages: Facet[] // path -> tabs on it
  countries: Facet[] // ISO alpha-2 -> tabs
  installed: boolean // a visitor has connected at least once
}
