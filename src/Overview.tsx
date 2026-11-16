import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import type { Analytics, Totals } from '../shared/api'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtNum } from '@/lib/format'

export type Metric = 'visits' | 'pageViews' | 'ratio'

const TABS: { id: Metric; label: string }[] = [
  { id: 'visits', label: 'Visits' },
  { id: 'pageViews', label: 'Page Views' },
  { id: 'ratio', label: 'Views / Visit' },
]

const BLUE = 'var(--blue)'
const config = { v: { label: 'Visits', color: BLUE } } satisfies ChartConfig

const value = (m: Metric, t: Totals) => (m === 'ratio' ? (t.visits ? t.pageViews / t.visits : 0) : t[m])
const fmtValue = (m: Metric, n: number) => (m === 'ratio' ? n.toFixed(1) : fmtNum(n))

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return null
  const pct = Math.round(((cur - prev) / prev) * 100)
  const up = pct >= 0
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
        up ? 'bg-[rgba(94,203,117,.2)] text-success' : 'bg-[rgba(255,99,99,.16)] text-destructive'
      }`}
    >
      {up ? '+' : ''}
      {pct}%
    </span>
  )
}

const DAY = { month: 'short', day: 'numeric', timeZone: 'UTC' } as const
const parse = (t: string) => new Date(t.length > 10 ? t : `${t}T00:00:00Z`)
const hh = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:00`

// Y axis: [0, mid, nice max], nice max from 1/2/4/6/8/10 x 10^k.
function yTicks(max: number) {
  const mag = 10 ** Math.floor(Math.log10(Math.max(max, 1e-9)))
  const top = ([1, 2, 4, 6, 8, 10].find((s) => s * mag >= max) ?? 10) * mag
  return [0, top / 2, top]
}

function Chart({ data, metric }: { data: Analytics; metric: Metric }) {
  const hour = data.granularity === 'hour'
  const n = data.series.length
  const vals = data.series.map((p) => value(metric, p))
  const rows = data.series.map((p, i) => ({
    t: p.t,
    v: vals[i],
    solid: i < n - 1 ? vals[i] : null,
    live: i >= n - 2 ? vals[i] : null,
  }))
  const ticks = yTicks(Math.max(...vals, 0))
  const xTicks = [...new Set(Array.from({ length: Math.min(8, n) }, (_, i) => rows[Math.round((i * (n - 1)) / (Math.min(8, n) - 1 || 1))].t))]
  const label = TABS.find((t) => t.id === metric)!.label

  return (
    <ChartContainer config={config} className="aspect-auto h-[400px] w-full [&_.recharts-tooltip-cursor]:stroke-foreground!">
      <AreaChart data={rows} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="cf-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: BLUE, stopOpacity: 0.2 }} />
            <stop offset="100%" style={{ stopColor: BLUE, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#333" />
        <XAxis
          dataKey="t"
          ticks={xTicks}
          minTickGap={16}
          axisLine={false}
          tickLine={false}
          tickMargin={14}
          tick={{ fontSize: 12, fill: '#a1a1a1' }}
          tickFormatter={(t: string) => (hour ? hh(parse(t)) : parse(t).toLocaleDateString('en-US', DAY))}
        />
        <YAxis
          ticks={ticks}
          domain={[0, ticks[2]]}
          width={48}
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          tick={{ fontSize: 12, fill: '#a1a1a1' }}
          tickFormatter={(v: number) => (metric === 'ratio' ? String(+v.toFixed(2)) : fmtNum(v))}
        />
        <ChartTooltip
          isAnimationActive={false}
          offset={16}
          cursor={{ stroke: '#ededed', strokeWidth: 1 }}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as (typeof rows)[number] | undefined
            if (!active || !row) return null
            const d = parse(row.t)
            return (
              <div className="rounded-lg border border-line-strong bg-card px-3 py-2 text-sm shadow-lg shadow-black/50">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-blue" />
                  <span>{label}</span>
                  <span className="font-semibold tabular-nums">{fmtValue(metric, row.v)}</span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {d.toLocaleDateString('en-US', DAY)} · {hour ? hh(d) : d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}
                </div>
              </div>
            )
          }}
        />
        <Area dataKey="solid" type="linear" stroke={BLUE} strokeWidth={2} fill="url(#cf-fill)" dot={false} activeDot={{ r: 4, fill: BLUE, stroke: 'none' }} isAnimationActive={false} />
        <Area dataKey="live" type="linear" stroke={BLUE} strokeWidth={2} strokeDasharray="4 8" fill="none" dot={false} activeDot={{ r: 4, fill: BLUE, stroke: 'none' }} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  )
}

export default function MetricCard({
  data,
  error,
  loading,
  metric,
  onMetric,
  onRetry,
}: {
  data: Analytics | null
  error: string
  loading: boolean
  metric: Metric
  onMetric: (m: Metric) => void
  onRetry: () => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex border-b border-line-strong bg-strip">
        {TABS.map((t) => {
          const active = t.id === metric
          return (
            <button
              key={t.id}
              onClick={() => onMetric(t.id)}
              className={`relative flex min-w-0 flex-1 flex-col items-stretch border-r border-border p-3 text-left sm:w-[260px] sm:flex-none sm:p-5 ${active ? 'bg-card' : ''}`}
            >
              <div className="truncate text-[13px] font-semibold tracking-[-0.28px] text-muted-foreground sm:text-sm">{t.label}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {data ? (
                  <>
                    <span className="text-2xl font-semibold tracking-[-0.79px] tabular-nums sm:text-[32px] sm:leading-[40px]">
                      {fmtValue(t.id, value(t.id, data.totals))}
                    </span>
                    <Delta cur={value(t.id, data.totals)} prev={value(t.id, data.previous)} />
                  </>
                ) : (
                  <Skeleton className="h-8 w-20 bg-bar" />
                )}
              </div>
              {active && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />}
            </button>
          )
        })}
      </div>
      <div className={`p-2 pt-4 transition-opacity sm:p-6 ${loading && data ? 'opacity-60' : ''}`}>
        {data ? (
          <Chart data={data} metric={metric} />
        ) : error ? (
          <div className="flex h-[400px] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p>{error}</p>
            <button onClick={onRetry} className="rounded-md border border-line-strong px-3 py-1.5 text-foreground hover:bg-accent">
              Retry
            </button>
          </div>
        ) : (
          <Skeleton className="h-[400px] w-full bg-bar" />
        )}
      </div>
    </div>
  )
}
