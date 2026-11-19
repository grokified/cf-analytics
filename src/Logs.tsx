import { useEffect, useRef, useState } from 'react'
import { Download, Play, RotateCw, Search, SlidersHorizontal } from 'lucide-react'
import {
  LOG_RANGES,
  type LogsPage,
  type Me,
  type RequestLog,
  type RuntimeLog,
  type Site,
} from '../shared/api'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { api } from '@/lib/api'
import Header from './Header'
import LogDetails from './LogDetails'
import LogsFilters, { type Filters, type View } from './LogsFilters'
import { Histogram, LogsTable } from './LogsTable'

export type Log = RequestLog | RuntimeLog

const SEL_KEYS: Record<View, string[]> = {
  requests: ['status', 'method', 'cache', 'host'],
  runtime: ['level', 'worker', 'outcome'],
}
const ALL_SEL = [...SEL_KEYS.requests, ...SEL_KEYS.runtime]

function parse(q: URLSearchParams): Filters {
  return {
    view: q.get('view') === 'runtime' ? 'runtime' : 'requests',
    range: LOG_RANGES.find((r) => r === q.get('range')) ?? '1h',
    q: q.get('q') ?? '',
    source: q.get('source') === 'all' ? 'all' : 'visitors',
    sel: Object.fromEntries(ALL_SEL.map((k) => [k, q.get(k)?.split(',').filter(Boolean) ?? []])),
  }
}

type State = { view: View; rows: Log[]; page: LogsPage<Log> | null; next: string | null }
const EMPTY: State = { view: 'requests', rows: [], page: null, next: null }

const merge = (a: Log[], b: Log[]) => {
  const seen = new Set<string>()
  return [...a, ...b].filter((r) => !seen.has(r.id) && seen.add(r.id))
}

export default function Logs({ me, onLogout, onNavigate }: { me: Me; onLogout: () => void; onNavigate: (to: string) => void }) {
  const q0 = new URLSearchParams(location.search)
  const [account, setAccount] = useState(q0.get('account') ?? me.accounts[0]?.id ?? '')
  const [site, setSite] = useState(q0.get('site') ?? 'all')
  const [f, setF] = useState(() => parse(q0))
  const [qInput, setQInput] = useState(f.q)
  const [logId, setLogId] = useState(q0.get('log') ?? '')
  const [sites, setSites] = useState<Site[] | null>(null)
  const [st, setSt] = useState<State>(EMPTY)
  const [done, setDone] = useState('')
  const [more, setMore] = useState(false)
  const [err, setErr] = useState<{ status?: number; message: string } | null>(null)
  const [live, setLive] = useState(false)
  const [tick, setTick] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const current = sites?.find((s) => s.accountId === account && s.siteTag === site)
  const zone = current?.zoneTag ?? null
  const view = f.view
  const ready = view === 'runtime' ? !!account : !!zone
  const blocked = view === 'requests' && site === 'all' ? true : sites !== null && !ready

  const base = new URLSearchParams(view === 'requests' ? { zone: zone ?? '' } : { account })
  base.set('range', f.range)
  if (f.q) base.set('q', f.q)
  if (view === 'requests') base.set('source', f.source)
  for (const k of SEL_KEYS[view]) if (f.sel[k].length) base.set(k, f.sel[k].join(','))
  const url = `/api/logs/${view}?${base}`
  const urlRef = useRef(url)
  useEffect(() => {
    urlRef.current = url
  }, [url])
  const fetching = ready && !blocked
  const key = `${url}|${tick}`
  const loading = fetching && done !== key

  // Refetch on Refresh and whenever the tab comes back into view, so sites added in Cloudflare show up.
  useEffect(() => {
    // A failed refetch keeps the list we already have.
    const load = () => api<Site[]>('/api/sites').then(setSites, () => setSites((p) => p ?? []))
    const onVisible = () => document.visibilityState === 'visible' && load()
    load()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [tick])

  useEffect(() => {
    const t = setTimeout(() => setF((p) => (p.q === qInput ? p : { ...p, q: qInput })), 300)
    return () => clearTimeout(t)
  }, [qInput])

  useEffect(() => {
    const p = new URLSearchParams(location.search)
    const set = (k: string, v: string, d = '') => (v && v !== d ? p.set(k, v) : p.delete(k))
    set('account', account)
    set('site', site, 'all')
    set('view', f.view, 'requests')
    set('range', f.range, '1h')
    set('q', f.q)
    set('source', f.source, 'visitors')
    for (const k of ALL_SEL) set(k, f.sel[k].join(','))
    set('log', logId)
    const s = p.toString()
    history.replaceState(null, '', `${location.pathname}${s ? `?${s}` : ''}`)
  }, [account, site, f, logId])

  useEffect(() => {
    if (!fetching) return
    const ac = new AbortController()
    api<LogsPage<Log>>(url, { signal: ac.signal }).then(
      (page) => {
        setSt({ view, rows: page.rows, page, next: page.nextBefore })
        setErr(null)
        setDone(key)
      },
      (e: Error & { status?: number }) => {
        if (ac.signal.aborted) return
        setErr({ status: e.status, message: e.message })
        setDone(key)
      },
    )
    return () => ac.abort()
  }, [url, fetching, view, key])

  useEffect(() => {
    if (!live || !fetching) return
    const id = setInterval(() => {
      api<LogsPage<Log>>(url).then(
        (page) => setSt((s) => (s.view === view ? { view, page, rows: merge(page.rows, s.rows), next: s.next } : s)),
        () => {},
      )
    }, 5000)
    return () => clearInterval(id)
  }, [live, fetching, url, view])

  async function older() {
    if (!st.next || more) return
    setMore(true)
    const from = url
    try {
      const page = await api<LogsPage<Log>>(`${url}&before=${encodeURIComponent(st.next)}`)
      // Drop the page if the filters changed while it was loading.
      if (urlRef.current === from) setSt((s) => ({ ...s, rows: merge(s.rows, page.rows), next: page.nextBefore }))
    } catch (e) {
      setErr({ status: (e as { status?: number }).status, message: (e as Error).message })
    }
    setMore(false)
  }

  function download() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }))
    a.download = `${view}-logs-${f.range}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const change = (patch: Partial<Filters>) => setF((p) => ({ ...p, ...patch }))
  const setView = (v: View) => {
    setLogId('')
    setErr(null)
    change({ view: v })
  }
  const rows = st.view === view && fetching ? st.rows : []
  const page = st.view === view && fetching ? st.page : null
  const selected = rows.find((r) => r.id === logId) ?? null
  const filters = (
    <LogsFilters f={f} onChange={change} onView={setView} facets={page?.facets ?? {}} />
  )

  return (
    <div className="flex h-dvh flex-col bg-background">
      <Header
        sites={sites ?? []}
        account={account}
        site={site}
        path="/logs"
        onSelect={(a, s) => {
          setAccount(a)
          setSite(s)
          setLogId('')
        }}
        onNavigate={onNavigate}
        onLogout={onLogout}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[280px] shrink-0 overflow-y-auto border-r border-border md:block">{filters}</aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 p-3">
            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
              <Button
                variant="outline"
                className="h-9 border-border bg-card md:hidden"
                onClick={() => setFiltersOpen(true)}
              >
                <SlidersHorizontal />
                Filters
              </Button>
              <SheetContent side="left" showCloseButton={false} className="w-[300px] gap-0 overflow-y-auto border-r border-border bg-card p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>Filters</SheetTitle>
                </SheetHeader>
                {filters}
              </SheetContent>
            </Sheet>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder={view === 'requests' ? 'Search paths…' : 'Search logs…'}
                className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-line-strong"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setLive((l) => !l)}
              className={`h-9 border-border bg-card ${live ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {live ? <span className="size-2 animate-pulse rounded-full bg-success" /> : <Play />}
              <span className="hidden sm:inline">Live</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh"
              onClick={() => setTick((t) => t + 1)}
              className="size-9 border-border bg-card"
            >
              <RotateCw className={loading ? 'animate-spin' : ''} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Download"
              disabled={!rows.length}
              onClick={download}
              className="size-9 border-border bg-card"
            >
              <Download />
            </Button>
          </div>
          {blocked ? (
            <Empty>
              <p className="text-sm font-medium">Pick a site in the switcher to see its request logs</p>
              {site !== 'all' && sites && !zone && (
                <p className="mt-1 text-sm text-muted-foreground">
                  This site isn't proxied through Cloudflare, so there are no request logs.
                </p>
              )}
            </Empty>
          ) : (
            <>
              <Histogram page={page} range={f.range} />
              <div className={`min-h-0 flex-1 overflow-auto transition-opacity ${loading ? 'opacity-50' : ''}`}>
                {err && !rows.length ? (
                  <ErrorBox err={err} view={view} />
                ) : (
                  <LogsTable
                    view={view}
                    rows={rows}
                    selectedId={logId}
                    onSelect={(id) => setLogId(id)}
                    next={st.next}
                    more={more}
                    onMore={older}
                    loaded={!!page}
                    q={f.q}
                  />
                )}
              </div>
            </>
          )}
        </main>
      </div>
      <Sheet open={!!selected} onOpenChange={(o) => !o && setLogId('')}>
        <SheetContent className="w-full gap-0 overflow-y-auto border-l border-border bg-card p-0 sm:max-w-[440px]!">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="text-sm font-medium">Log Details</SheetTitle>
          </SheetHeader>
          {selected && <LogDetails view={view} log={selected} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">{children}</div>
}

function ErrorBox({ err, view }: { err: { status?: number; message: string }; view: View }) {
  return (
    <Empty>
      <p className="text-sm font-medium text-destructive">{err.message}</p>
      {err.status === 403 && (
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {view === 'requests'
            ? 'Add "Zone › Analytics › Read" to your Cloudflare API token'
            : 'Add "Account › Workers Observability › Edit" to your Cloudflare API token'}{' '}
          at{' '}
          <a
            href="https://dash.cloudflare.com/profile/api-tokens"
            target="_blank"
            rel="noreferrer"
            className="text-foreground hover:underline"
          >
            dash.cloudflare.com/profile/api-tokens ↗
          </a>
          , then log in again.
        </p>
      )}
    </Empty>
  )
}
