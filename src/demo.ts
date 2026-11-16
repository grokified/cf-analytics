// Dev-only fixture (served when the URL has ?demo). Never reaches the production bundle.
import type { Analytics, Me, Point, Range, Row, Site } from '../shared/api'

const me: Me = { accounts: [{ id: 'acc1', name: 'Acme Inc' }] }
const hosts = ['acme.dev', 'docs.acme.dev', 'shop.acme.dev', 'blog.example.com', 'status.example.org']
const sites: Site[] = hosts.map((host, i) => ({
  accountId: 'acc1',
  accountName: me.accounts[0].name,
  siteTag: `tag${i + 1}`,
  host,
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
}
