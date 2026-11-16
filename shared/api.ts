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
