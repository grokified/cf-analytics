import { useState, type ReactNode } from 'react'
import { Ellipsis } from 'lucide-react'
import type { Analytics, Row } from '../shared/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { browserName, capitalize, countryName, favicon, flag, fmtNum } from '@/lib/format'
import type { Metric } from './Overview'

const MAX_ROWS = 8

type Tab = {
  label: string
  rows: Row[]
  percent?: boolean
  text?: (key: string) => string
  icon?: (key: string) => ReactNode
}

type Item = { key: string; v: number }

function BarRows({ items, total, tab }: { items: Item[]; total: number; tab: Tab }) {
  const max = items[0]?.v || 1
  const text = tab.text ?? ((k: string) => k)
  return (
    <div className="flex flex-col gap-2.5">
      {items.map(({ key, v }) => (
        <div key={key} className="relative h-9 rounded-md hover:bg-white/[.03]">
          <div className="absolute inset-y-0 left-0 rounded-md bg-bar" style={{ width: `${(v / max) * 100}%` }} />
          <div className="relative flex h-full items-center justify-between gap-3 px-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {tab.icon?.(key)}
              <span className="truncate">{text(key)}</span>
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="font-semibold tabular-nums">
                  {tab.percent ? `${Math.round((v / total) * 100)}%` : fmtNum(v)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {v.toLocaleString('en-US')} · {((v / total) * 100).toFixed(1)}%
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      ))}
    </div>
  )
}

function Panel({
  tabs,
  data,
  error,
  metric,
  onRetry,
}: {
  tabs: Tab[]
  data: Analytics | null
  error: string
  metric: Metric
  onRetry: () => void
}) {
  const [i, setI] = useState(0)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const tab = tabs[i]
  const field = metric === 'visits' ? 'visits' : 'pageViews'
  const items: Item[] = tab.rows
    .map((r) => ({ key: r.key, v: r[field] }))
    .filter((r) => r.v > 0)
    .sort((a, b) => b.v - a.v)
  const total = items.reduce((s, r) => s + r.v, 0)
  const text = tab.text ?? ((k: string) => k)
  const filtered = items.filter((r) => text(r.key).toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex h-[60px] items-center justify-between border-b border-border px-6">
        <div className="flex h-full gap-8">
          {tabs.map((t, idx) => (
            <button
              key={t.label}
              onClick={() => setI(idx)}
              className={`relative h-full px-[3px] text-sm ${idx === i ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t.label}
              {idx === i && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />}
            </button>
          ))}
        </div>
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {metric === 'visits' ? 'Visits' : 'Page views'}
        </span>
      </div>
      <div className="flex h-[410px] flex-col p-3">
        {!data ? (
          error ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <p>{error}</p>
              <button onClick={onRetry} className="rounded-md border border-line-strong px-3 py-1 text-foreground hover:bg-accent">Retry</button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {Array.from({ length: MAX_ROWS }, (_, n) => (
                <Skeleton key={n} className="h-9 bg-bar" style={{ width: `${100 - n * 9}%` }} />
              ))}
            </div>
          )
        ) : items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">No data for this period</div>
        ) : (
          <>
            <div className="flex-1">
              <BarRows items={items.slice(0, MAX_ROWS)} total={total} tab={tab} />
            </div>
            <div className="mt-2 flex h-5 justify-center">
              {items.length > MAX_ROWS && (
                <button
                  aria-label="View all"
                  onClick={() => setOpen(true)}
                  className="flex h-5 w-12 items-center justify-center rounded-full border border-line-strong bg-card text-muted-foreground hover:text-foreground"
                >
                  <Ellipsis className="size-3.5" />
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFilter('') }}>
        <DialogContent className="max-h-[85vh] grid-rows-[auto_auto_1fr] border border-line-strong ring-0 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{tab.label}</DialogTitle>
          </DialogHeader>
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="h-9 rounded-md bg-card" />
          <div className="min-h-0 overflow-y-auto">
            {filtered.length ? <BarRows items={filtered} total={total} tab={tab} /> : <p className="py-8 text-center text-sm text-muted-foreground">No matches</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function Breakdowns(props: { data: Analytics | null; error: string; loading: boolean; metric: Metric; onRetry: () => void }) {
  const { data, error, loading, metric, onRetry } = props
  const rows = (k: keyof Analytics) => ((data?.[k] as Row[] | undefined) ?? [])
  const host = (k: string) => k
  const hostIcon = (k: string) => <img src={favicon(k)} alt="" className="size-4 shrink-0 rounded-sm" />
  const P = (tabs: Tab[]) => <Panel tabs={tabs} data={data} error={error} metric={metric} onRetry={onRetry} />

  return (
    <div className={`transition-opacity ${loading && data ? 'opacity-60' : ''}`}>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {P([
          { label: 'Pages', rows: rows('pages') },
          { label: 'Hostnames', rows: rows('hostnames') },
        ])}
        {P([{ label: 'Referrers', rows: rows('referrers'), text: host, icon: hostIcon }])}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {P([{ label: 'Countries', rows: rows('countries'), percent: true, text: countryName, icon: (k) => <span className="text-base leading-none">{flag(k)}</span> }])}
        {P([
          { label: 'Devices', rows: rows('devices'), percent: true, text: capitalize },
          { label: 'Browsers', rows: rows('browsers'), percent: true, text: browserName },
        ])}
        {P([{ label: 'Operating Systems', rows: rows('os'), percent: true }])}
      </div>
    </div>
  )
}
