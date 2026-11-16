import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { Facet, LiveSnapshot, LiveTicket } from '../shared/api'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from '@/lib/api'
import { countryName, flag, fmtNum } from '@/lib/format'

/** Opens one WebSocket per site host and keeps the latest snapshot of each. */
function useLive(account: string, site: string) {
  const [snaps, setSnaps] = useState<Record<string, LiveSnapshot>>({})

  useEffect(() => {
    let stop = false
    const sockets = new Set<WebSocket>()
    api<LiveTicket[]>(`/api/live/tickets?${new URLSearchParams({ account, site })}`).then(
      (tickets) => {
        if (stop || !Array.isArray(tickets)) return // demo mode has no live data
        for (const { host, ticket } of tickets) {
          const open = (delay: number) => {
            let opened = false
            const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/live?${new URLSearchParams({ host, t: ticket })}`)
            sockets.add(ws)
            ws.onopen = () => (opened = true)
            ws.onmessage = (e) => setSnaps((s) => ({ ...s, [host]: JSON.parse(e.data) as LiveSnapshot }))
            ws.onclose = () => {
              sockets.delete(ws)
              // Reconnect after deploys and network drops; a refused ticket (expired) stays closed.
              if (opened && !stop) setTimeout(() => !stop && open(Math.min(delay * 2, 30_000)), delay)
            }
          }
          open(1000)
        }
      },
      () => {},
    )
    return () => {
      stop = true
      sockets.forEach((ws) => ws.close())
      setSnaps({})
    }
  }, [account, site])

  return snaps
}

const merge = (lists: [string, Facet[]][], prefixHost: boolean): Facet[] => {
  const m = new Map<string, number>()
  for (const [host, facets] of lists) for (const f of facets) {
    const key = prefixHost ? `${host}${f.key}` : f.key
    m.set(key, (m.get(key) ?? 0) + f.count)
  }
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
}

/** "N online" with a popover: live pages and countries once /rt.js is installed, setup steps before that. */
export default function LiveIndicator({ account, site, estimate }: { account: string; site: string; estimate: number }) {
  const snaps = Object.entries(useLive(account, site))
  const live = snaps.some(([, s]) => s.installed)
  const online = live ? snaps.reduce((n, [, s]) => n + s.online, 0) : estimate
  const pages = merge(snaps.map(([h, s]) => [h, s.pages]), site === 'all')
  const countries = merge(snaps.map(([h, s]) => [h, s.countries]), false)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-0.5 outline-none hover:bg-accent focus-visible:bg-accent">
          <span className={`size-2 rounded-full ${online ? 'bg-success' : 'bg-[#555]'} ${live && online ? 'animate-pulse' : ''}`} />
          {fmtNum(online)} online
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 border border-line-strong p-0 ring-0">
        {live ? (
          <div className="max-h-96 overflow-y-auto p-3 text-sm">
            <p className="font-medium">Live now</p>
            <p className="text-xs text-muted-foreground">Open tabs, updated the moment visitors come and go</p>
            {online === 0 ? (
              <p className="mt-3 text-muted-foreground">No one is on the site right now.</p>
            ) : (
              <>
                <List title="Pages" rows={pages.slice(0, 8)} label={(k) => <span className="truncate font-mono text-xs">{k}</span>} />
                <List
                  title="Countries"
                  rows={countries.slice(0, 6)}
                  label={(k) => (
                    <span className="truncate">
                      <span className="mr-2">{flag(k)}</span>
                      {countryName(k)}
                    </span>
                  )}
                />
              </>
            )}
          </div>
        ) : (
          <Setup />
        )}
      </PopoverContent>
    </Popover>
  )
}

function List({ title, rows, label }: { title: string; rows: Facet[]; label: (key: string) => React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs text-muted-foreground">{title}</p>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-3 py-0.5">
          {label(r.key)}
          <span className="shrink-0 tabular-nums text-muted-foreground">{r.count}</span>
        </div>
      ))}
    </div>
  )
}

function Setup() {
  const [copied, setCopied] = useState(false)
  const snippet = `<script src="${location.origin}/rt.js" defer></script>`
  return (
    <div className="p-3 text-sm">
      <p className="font-medium">See visitors in real time</p>
      <p className="mt-1 text-muted-foreground">
        This number is an estimate from Cloudflare Web Analytics, which arrives 1–2 minutes late. Add this script to every page
        of the site to count open tabs live:
      </p>
      <div className="mt-2 flex items-start gap-2 rounded-md border border-border bg-background p-2">
        <code className="min-w-0 flex-1 break-all font-mono text-xs">{snippet}</code>
        <button
          aria-label="Copy snippet"
          onClick={() => {
            navigator.clipboard.writeText(snippet).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        No cookies. If the site sends a Content-Security-Policy, allow this origin in script-src and connect-src. For a subdomain,
        add data-site="your-site.com".
      </p>
    </div>
  )
}
