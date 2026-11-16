import { useEffect, useState } from 'react'
import { Calendar, ChevronDown, ExternalLink, Globe, RotateCw } from 'lucide-react'
import { RANGES, type Analytics, type Me, type Range, type Site } from '../shared/api'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import Breakdowns from './Breakdowns'
import Header, { Favicon } from './Header'
import MetricCard, { type Metric } from './Overview'

const RANGE_LABEL: Record<Range, string> = { '24h': 'Last 24 Hours', '7d': 'Last 7 Days', '30d': 'Last 30 Days', '90d': 'Last 3 Months' }
const METRICS: Metric[] = ['visits', 'pageViews', 'ratio']

export default function Dashboard({ me, onLogout, onNavigate }: { me: Me; onLogout: () => void; onNavigate: (to: string) => void }) {
  const q = new URLSearchParams(location.search)
  const [account, setAccount] = useState(q.get('account') ?? me.accounts[0]?.id ?? '')
  const [site, setSite] = useState(q.get('site') ?? 'all')
  const [range, setRange] = useState<Range>(RANGES.find((r) => r === q.get('range')) ?? '7d')
  const [metric, setMetric] = useState<Metric>(METRICS.find((m) => m === q.get('metric')) ?? 'visits')
  const [sites, setSites] = useState<Site[]>([])
  const [data, setData] = useState<Analytics | null>(null)
  const [done, setDone] = useState({ key: '', error: '' })
  const [sitesError, setSitesError] = useState('')
  const [tick, setTick] = useState(0)
  const key = `${account}|${site}|${range}|${tick}`
  const loading = done.key !== key
  const error = (loading ? '' : done.error) || sitesError

  useEffect(() => {
    api<Site[]>('/api/sites').then(setSites, (e: Error) => setSitesError(e.message))
  }, [])

  useEffect(() => {
    const p = new URLSearchParams(location.search)
    Object.entries({ account, site, range, metric }).forEach(([k, v]) => p.set(k, v))
    history.replaceState(null, '', `?${p}`)
  }, [account, site, range, metric])

  useEffect(() => {
    const ac = new AbortController()
    api<Analytics>(`/api/analytics?${new URLSearchParams({ account, site, range })}`, { signal: ac.signal }).then(
      (d) => {
        setData(d)
        setDone({ key, error: '' })
      },
      (e: Error) => {
        if (!ac.signal.aborted) setDone({ key, error: e.message })
      },
    )
    return () => ac.abort()
  }, [account, site, range, key])

  // Re-poll every minute so "online" stays current. Silent: no dimming, errors ignored.
  useEffect(() => {
    const ac = new AbortController()
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      api<Analytics>(`/api/analytics?${new URLSearchParams({ account, site, range })}`, { signal: ac.signal }).then(setData, () => {})
    }, 60_000)
    return () => {
      clearInterval(id)
      ac.abort()
    }
  }, [account, site, range])

  const current = sites.find((s) => s.accountId === account && s.siteTag === site)
  const extra = (data?.hostnames.length ?? 0) - 1

  return (
    <div className="min-h-screen bg-background pb-16">
      <Header sites={sites} account={account} site={site} path="/" onSelect={(a, s) => { setAccount(a); setSite(s) }} onNavigate={onNavigate} onLogout={onLogout} />
      <main className="mx-auto mt-6 w-full max-w-[1400px] px-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              {current ? (
                <>
                  <Favicon host={current.host} className="size-[18px]" />
                  <a href={`https://${current.host}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:underline">
                    {current.host}
                    <ExternalLink className="size-3.5" />
                  </a>
                </>
              ) : (
                <>
                  <Globe className="size-[18px] text-muted-foreground" />
                  All sites
                </>
              )}
              {extra > 0 && <span className="text-muted-foreground">+{extra}</span>}
            </div>
            <span className="text-line-strong">|</span>
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${data?.online ? 'bg-success' : 'bg-[#555]'}`} />
              {data?.online ?? 0} online
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex h-10 min-w-44 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm outline-none hover:bg-accent">
                  <Calendar className="size-4 text-muted-foreground" />
                  {RANGE_LABEL[range]}
                  <ChevronDown className="ml-auto size-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44 border border-line-strong ring-0">
                <DropdownMenuRadioGroup value={range} onValueChange={(v) => setRange(v as Range)}>
                  {RANGES.map((r) => (
                    <DropdownMenuRadioItem key={r} value={r}>{RANGE_LABEL[r]}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              aria-label="Refresh"
              onClick={() => setTick((t) => t + 1)}
              className="flex size-10 items-center justify-center rounded-md border border-border bg-card hover:bg-accent"
            >
              <RotateCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="mt-4">
          <MetricCard data={data} error={error} loading={loading} metric={metric} onMetric={setMetric} onRetry={() => setTick((t) => t + 1)} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Cloudflare Web Analytics · sampled · times in UTC</p>
        <Breakdowns data={data} error={error} loading={loading} metric={metric} onRetry={() => setTick((t) => t + 1)} />
      </main>
    </div>
  )
}
