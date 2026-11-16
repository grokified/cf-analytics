import { useState } from 'react'
import type { LogRange, LogsPage, RequestLog, RuntimeLog } from '../shared/api'
import type { Log } from './Logs'
import { AMBER, type View } from './LogsFilters'

const RED = 'oklch(0.6996 0.2136 22.03)'
const ERR_ROW = { background: 'rgb(72,26,29)', color: RED }
const WARN_ROW = { background: 'rgba(255,170,0,0.08)', color: AMBER }

const pad = (n: number) => String(n).padStart(2, '0')
const hms = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

function Time({ iso, ms }: { iso: string; ms?: boolean }) {
  const d = new Date(iso)
  const day = `${d.toLocaleString('en-US', { month: 'short' }).toUpperCase()} ${pad(d.getDate())}`
  return (
    <span>
      <span className="text-[#888]">{day}</span> <span>{hms(d)}</span>
      {ms && <span>.{pad(Math.floor(d.getMilliseconds() / 10))}</span>}
    </span>
  )
}

export function Histogram({ page, range }: { page: LogsPage<Log> | null; range: LogRange }) {
  const [hover, setHover] = useState<number | null>(null)
  const h = page?.histogram ?? []
  const max = Math.max(1, ...h.map((b) => b.ok + b.warn + b.error))
  const long = range === '24h' || range === '3d' || range === '7d'
  const label = (iso?: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    return long ? `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()} ${hms(d).slice(0, 5)}` : hms(d)
  }
  const hb = hover === null ? null : h[hover]
  return (
    <div className="border-b border-border px-3 pb-2">
      <div className="relative flex h-12 items-end gap-px" onMouseLeave={() => setHover(null)}>
        {h.map((b, i) => (
          <div key={b.t} onMouseEnter={() => setHover(i)} className="flex h-full min-w-0 flex-1 flex-col-reverse">
            <div style={{ height: `${(b.ok / max) * 100}%`, background: '#333' }} />
            <div style={{ height: `${(b.warn / max) * 100}%`, background: AMBER }} />
            <div style={{ height: `${(b.error / max) * 100}%`, background: RED }} />
          </div>
        ))}
        {hb && (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-line-strong bg-card px-2 py-1 text-[11px] tabular-nums"
            style={{ left: `clamp(70px, ${((hover! + 0.5) / h.length) * 100}%, calc(100% - 70px))` }}
          >
            <div className="text-[#888]">{label(hb.t)}</div>
            {hb.ok} ok · <span style={{ color: AMBER }}>{hb.warn} warn</span> · <span style={{ color: RED }}>{hb.error} error</span>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-[#888]">
        <span>{label(page?.from)}</span>
        <span>{page && label(new Date((new Date(page.from).getTime() + new Date(page.to).getTime()) / 2).toISOString())}</span>
        <span>{label(page?.to)}</span>
      </div>
    </div>
  )
}

const COLS: Record<View, { grid: string; head: string[] }> = {
  requests: { grid: '150px 72px 170px minmax(0,1fr)', head: ['Time', 'Status', 'Host', 'Request'] },
  runtime: { grid: '170px 90px 140px minmax(0,1fr)', head: ['Time', 'Level', 'Worker', 'Message'] },
}

function statusStyle(s: number) {
  if (s >= 500) return { color: RED }
  if (s >= 400) return { color: AMBER }
  if (s >= 300) return { color: 'var(--blue)' }
  return undefined
}

function levelDot(l: string) {
  return l === 'error' ? RED : l === 'warn' ? AMBER : '#a1a1a1'
}

export function LogsTable({
  view,
  rows,
  selectedId,
  onSelect,
  next,
  more,
  onMore,
  loaded,
  q,
}: {
  view: View
  rows: Log[]
  selectedId: string
  onSelect: (id: string) => void
  next: string | null
  more: boolean
  onMore: () => void
  loaded: boolean
  q: string
}) {
  const { grid, head } = COLS[view]
  const cell = 'truncate px-3'
  return (
    <div className="min-w-[760px]">
      <div
        className="sticky top-0 z-10 grid h-9 items-center border-b border-border bg-background text-sm font-medium text-[#888]"
        style={{ gridTemplateColumns: grid }}
      >
        {head.map((h) => (
          <span key={h} className={cell}>
            {h}
          </span>
        ))}
      </div>
      {rows.map((r) => {
        const rq = view === 'requests' ? (r as RequestLog) : null
        const rt = view === 'runtime' ? (r as RuntimeLog) : null
        const tone = rq ? (rq.status >= 500 ? ERR_ROW : rq.status >= 400 ? WARN_ROW : null) : rt!.level === 'error' ? ERR_ROW : rt!.level === 'warn' ? WARN_ROW : null
        return (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            className={`grid h-[26px] w-full items-center text-left font-mono text-[13px] leading-[26px] ${
              !tone && (r.id === selectedId ? 'bg-[#1a1a1a]' : 'hover:bg-[#111]')
            }`}
            style={{ gridTemplateColumns: grid, ...(tone ?? {}), ...(tone && r.id === selectedId ? { filter: 'brightness(1.3)' } : {}) }}
          >
            <span className={cell}>
              <Time iso={r.time} ms={!!rt} />
            </span>
            {rq ? (
              <>
                <span className={cell} style={statusStyle(rq.status)}>
                  {rq.status}
                </span>
                <span className={`${cell} ${tone ? '' : 'text-[#888]'}`}>{rq.host}</span>
                <span className={cell}>
                  {rq.method} {rq.path}
                  <span className={tone ? 'opacity-70' : 'text-[#888]'}>{rq.query}</span>
                </span>
              </>
            ) : (
              <>
                <span className={`${cell} flex items-center gap-2`}>
                  <span className="size-2 shrink-0 rounded-full" style={{ background: levelDot(rt!.level) }} />
                  {rt!.level}
                </span>
                <span className={`${cell} ${tone ? '' : 'text-[#888]'}`}>{rt!.worker}</span>
                <span className={cell}>{rt!.message.split('\n')[0]}</span>
              </>
            )}
          </button>
        )
      })}
      <div className="flex h-14 items-center justify-center text-sm text-muted-foreground">
        {next ? (
          <button
            onClick={onMore}
            disabled={more}
            className="h-8 rounded-md border border-border bg-card px-3 text-foreground hover:bg-accent disabled:opacity-50"
          >
            {more ? 'Loading…' : 'Load older logs'}
          </button>
        ) : loaded ? (
          rows.length ? 'No more logs to show within selected timeline' : q ? 'No logs match your search' : 'No logs in selected timeline'
        ) : null}
      </div>
    </div>
  )
}
