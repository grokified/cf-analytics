import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import type { RequestLog, RuntimeLog } from '../shared/api'
import { browserName, capitalize, countryName, flag } from '@/lib/format'
import type { Log } from './Logs'
import type { View } from './LogsFilters'

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      aria-label="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        })
      }}
      className="shrink-0 text-muted-foreground hover:text-foreground"
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium text-[#888]">{title}</h3>
      <div className="divide-y divide-border rounded-lg border border-border">{children}</div>
    </section>
  )
}

function KV({ k, children, copy, wrap }: { k: string; children: ReactNode; copy?: string; wrap?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5">
      <span className="shrink-0 text-sm font-medium text-[#888]">{k}</span>
      <span className="flex min-w-0 items-center gap-1.5 font-mono text-[13px] text-[#ededed]">
        <span className={wrap ? 'break-all text-right' : 'truncate'}>{children}</span>
        {copy && <CopyBtn text={copy} />}
      </span>
    </div>
  )
}

function Requests({ r }: { r: RequestLog }) {
  return (
    <>
      <Card title="Request">
        <div className="flex items-center gap-2 px-3 py-2.5 font-mono text-[13px]">
          <span className="shrink-0 rounded border border-line-strong px-1.5 text-xs">{r.method}</span>
          <span className="truncate">{r.path}</span>
        </div>
        <KV k="Host">{r.host}</KV>
        <KV k="Query">{r.query || '—'}</KV>
        <KV k="Ray ID" copy={r.id}>{r.id}</KV>
        <KV k="Status">{r.status}</KV>
        <KV k="Protocol">{r.protocol}</KV>
        <KV k="Content type">{r.contentType || '—'}</KV>
      </Card>
      <Card title="Client">
        <KV k="Country">
          {flag(r.country)} {countryName(r.country)}
        </KV>
        <KV k="Device">{capitalize(r.device)}</KV>
        <KV k="Browser">{browserName(r.browser)}</KV>
        <KV k="OS">{r.os}</KV>
        <KV k="ASN">
          {r.asn} · {r.asnName}
        </KV>
        <KV k="User agent" wrap>
          {r.userAgent}
        </KV>
      </Card>
      <Card title="Edge">
        <KV k="Cache">{r.cache}</KV>
        <KV k="Origin status">{r.originStatus || '—'}</KV>
        <KV k="Origin time">{r.originMs} ms</KV>
        <KV k="Source">{r.source}</KV>
        {r.securityAction !== 'unknown' && <KV k="Security action">{r.securityAction}</KV>}
        {r.securitySource !== 'unknown' && <KV k="Security source">{r.securitySource}</KV>}
        {r.botCategory && <KV k="Verified bot">{r.botCategory}</KV>}
      </Card>
    </>
  )
}

function Runtime({ r }: { r: RuntimeLog }) {
  const ms = (v: number | null) => (v === null ? '—' : `${v} ms`)
  return (
    <>
      <Card title="Message">
        <pre
          className={`whitespace-pre-wrap break-words p-3 font-mono text-[13px] ${r.level === 'error' ? 'rounded-lg bg-[rgb(72,26,29)] text-[oklch(0.6996_0.2136_22.03)]' : ''}`}
        >
          {r.message}
        </pre>
      </Card>
      <Card title="Invocation">
        <KV k="Worker">{r.worker}</KV>
        <KV k="Trigger">{r.trigger || '—'}</KV>
        <KV k="Event type">{r.eventType || '—'}</KV>
        <KV k="Outcome">{r.outcome || '—'}</KV>
        <KV k="Wall time">{ms(r.wallMs)}</KV>
        <KV k="CPU time">{ms(r.cpuMs)}</KV>
        {r.rayId && (
          <KV k="Ray ID" copy={r.rayId}>
            {r.rayId}
          </KV>
        )}
        {r.requestId && (
          <KV k="Request ID" copy={r.requestId}>
            {r.requestId}
          </KV>
        )}
      </Card>
      <details className="group">
        <summary className="mb-2 cursor-pointer text-sm font-medium text-[#888]">Raw event</summary>
        <pre className="overflow-x-auto rounded-lg border border-border p-3 font-mono text-xs">
          {JSON.stringify(r.raw, null, 2)}
        </pre>
      </details>
    </>
  )
}

export default function LogDetails({ view, log }: { view: View; log: Log }) {
  return (
    <div className="flex flex-col gap-5 p-4">
      {view === 'requests' ? <Requests r={log as RequestLog} /> : <Runtime r={log as RuntimeLog} />}
    </div>
  )
}
