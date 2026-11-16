import { useState, type ReactNode } from 'react'
import { ChevronDown, FileText, Globe } from 'lucide-react'
import { LOG_RANGES, type Facet, type LogRange } from '../shared/api'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { fmtNum } from '@/lib/format'

export type View = 'requests' | 'runtime'
export type Filters = {
  view: View
  range: LogRange
  q: string
  source: 'visitors' | 'all'
  sel: Record<string, string[]>
}

export const AMBER = 'oklch(0.82 0.16 75)'
const VIEWS: Record<View, string> = { requests: 'Request Logs', runtime: 'Runtime Logs' }
const RANGE_LABEL: Record<LogRange, string> = {
  '30m': 'Last 30 minutes',
  '1h': 'Last 1 hour',
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  '3d': 'Last 3 days',
  '7d': 'Last 7 days',
}
const STATUS_DOT: Record<string, string> = { '2xx': '#a1a1a1', '3xx': 'var(--blue)', '4xx': AMBER, '5xx': 'var(--destructive)' }
const LEVEL_DOT: Record<string, string> = {
  info: '#a1a1a1',
  log: '#a1a1a1',
  debug: '#a1a1a1',
  warn: AMBER,
  error: 'var(--destructive)',
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border-b border-border px-4 py-3">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 text-sm font-medium">
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`} />
        {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

function CheckRow({
  label,
  count,
  dot,
  checked,
  onChange,
}: {
  label: string
  count?: number
  dot?: string
  checked: boolean
  onChange: (c: boolean) => void
}) {
  return (
    <label className="flex h-8 cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      {dot && <span className="size-2 shrink-0 rounded-full" style={{ background: dot }} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="rounded-full bg-[#1a1a1a] px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{fmtNum(count)}</span>
      )}
    </label>
  )
}

function Menu({
  value,
  items,
  onChange,
  icon,
}: {
  value: string
  items: Record<string, string>
  onChange: (v: string) => void
  icon?: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-card px-3 text-sm outline-none hover:bg-accent">
          {icon}
          {items[value]}
          <ChevronDown className="ml-auto size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52 border border-line-strong ring-0">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {Object.entries(items).map(([k, l]) => (
            <DropdownMenuRadioItem key={k} value={k}>
              {l}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function LogsFilters({
  f,
  onChange,
  onView,
  facets,
}: {
  f: Filters
  onChange: (patch: Partial<Filters>) => void
  onView: (v: View) => void
  facets: Record<string, Facet[]>
}) {
  const toggle = (k: string, v: string, on: boolean) =>
    onChange({ sel: { ...f.sel, [k]: on ? [...f.sel[k], v] : f.sel[k].filter((x) => x !== v) } })

  // Facet counts ignore the checkbox filters, so selected values stay listed (at 0 when absent).
  const list = (k: string, fixed?: string[], dots?: Record<string, string>, label?: (s: string) => string) => {
    const counts = new Map((facets[k] ?? []).map((x) => [x.key, x.count]))
    const keys = [...new Set([...(fixed ?? []), ...counts.keys(), ...f.sel[k]])]
    if (!fixed) keys.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
    return keys.slice(0, 12).map((key) => (
      <CheckRow
        key={key}
        label={label ? label(key) : key}
        dot={dots?.[key]}
        count={counts.get(key) ?? 0}
        checked={f.sel[k].includes(key)}
        onChange={(c) => toggle(k, key, c)}
      />
    ))
  }

  return (
    <div>
      <div className="border-b border-border p-4">
        <Menu
          value={f.view}
          items={VIEWS}
          onChange={(v) => onView(v as View)}
          icon={
            f.view === 'requests' ? (
              <Globe className="size-4 text-muted-foreground" />
            ) : (
              <FileText className="size-4 text-muted-foreground" />
            )
          }
        />
      </div>
      <div className="px-4 pb-1 pt-4 text-sm font-medium">Filters</div>
      <Section title="Timeline">
        <Menu
          value={f.range}
          items={Object.fromEntries(LOG_RANGES.map((r) => [r, RANGE_LABEL[r]]))}
          onChange={(v) => onChange({ range: v as LogRange })}
        />
      </Section>
      {f.view === 'requests' ? (
        <>
          <Section title="Status">{list('status', ['2xx', '3xx', '4xx', '5xx'], STATUS_DOT)}</Section>
          <Section title="Method">{list('method')}</Section>
          <Section title="Cache">{list('cache')}</Section>
          <Section title="Host">{list('host')}</Section>
          <div className="px-4 py-3">
            <CheckRow
              label="Visitors only"
              checked={f.source === 'visitors'}
              onChange={(c) => onChange({ source: c ? 'visitors' : 'all' })}
            />
            <p className="mt-1 pl-6 text-xs text-muted-foreground">Off includes Worker subrequests.</p>
          </div>
        </>
      ) : (
        <>
          <Section title="Level">{list('level', ['info', 'log', 'debug', 'warn', 'error'], LEVEL_DOT, cap)}</Section>
          <Section title="Worker">{list('worker')}</Section>
          <Section title="Outcome">{list('outcome')}</Section>
        </>
      )}
    </div>
  )
}
