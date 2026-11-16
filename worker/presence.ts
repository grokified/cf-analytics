import { DurableObject } from 'cloudflare:workers'
import type { Facet, LiveSnapshot } from '../shared/api.ts'

// One Presence object per site host. Visitor tabs (/rt.js) and dashboards hold WebSockets to it.
// Uses the WebSocket Hibernation API, so idle connections cost no duration, and "ping" is answered
// without waking the object.

type Visitor = { p: string; c: string } // path, country

const HOST = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,63}$/

/** Lowercases, strips "www." and validates; returns "" when not a hostname. */
export const normHost = (h: string) => {
  const x = h.toLowerCase().replace(/^www\./, '')
  return HOST.test(x) ? x : ''
}

export const cleanPath = (p: string | null) => (p && p.startsWith('/') ? p.slice(0, 200) : '/')

export class Presence extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const visitor = url.pathname === '/visitor'
    if (visitor && !(await this.ctx.storage.get('registered'))) {
      return new Response('Open this site in the dashboard first', { status: 403 })
    }

    const [client, server] = Object.values(new WebSocketPair())
    if (visitor) {
      this.ctx.acceptWebSocket(server, ['v'])
      server.serializeAttachment({ p: cleanPath(url.searchParams.get('p')), c: url.searchParams.get('c') ?? '' } satisfies Visitor)
      if (!(await this.ctx.storage.get('installed'))) await this.ctx.storage.put('installed', true)
      await this.broadcast()
    } else {
      if (!(await this.ctx.storage.get('registered'))) await this.ctx.storage.put('registered', true)
      this.ctx.acceptWebSocket(server, ['d'])
      server.send(JSON.stringify(await this.snapshot()))
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    // Visitors send "p:/path" on client-side navigation. Dashboards send nothing.
    if (typeof msg !== 'string' || !msg.startsWith('p:') || !this.ctx.getTags(ws).includes('v')) return
    const v = ws.deserializeAttachment() as Visitor
    const p = cleanPath(msg.slice(2))
    if (p === v.p) return
    ws.serializeAttachment({ ...v, p } satisfies Visitor)
    await this.broadcast()
  }

  async webSocketClose(ws: WebSocket) {
    if (this.ctx.getTags(ws).includes('v')) await this.broadcast(ws)
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws)
  }

  private async snapshot(gone?: WebSocket): Promise<LiveSnapshot> {
    const pages = new Map<string, number>()
    const countries = new Map<string, number>()
    const visitors = this.ctx.getWebSockets('v').filter((w) => w !== gone && w.readyState === WebSocket.OPEN)
    for (const w of visitors) {
      const v = w.deserializeAttachment() as Visitor
      pages.set(v.p, (pages.get(v.p) ?? 0) + 1)
      if (v.c) countries.set(v.c, (countries.get(v.c) ?? 0) + 1)
    }
    const top = (m: Map<string, number>): Facet[] =>
      [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 20)
    return {
      online: visitors.length,
      pages: top(pages),
      countries: top(countries),
      installed: visitors.length > 0 || !!(await this.ctx.storage.get('installed')),
    }
  }

  // ponytail: rebuilds and sends the full snapshot on every join, leave and navigation. Fine for hundreds of
  // concurrent visitors per site; batch with a short alarm if a site gets thousands.
  private async broadcast(gone?: WebSocket) {
    const dashboards = this.ctx.getWebSockets('d')
    if (!dashboards.length) return
    const msg = JSON.stringify(await this.snapshot(gone))
    for (const d of dashboards) {
      try {
        d.send(msg)
      } catch {
        // closed between getWebSockets() and send()
      }
    }
  }
}

// ---- dashboard tickets: HMAC(host|exp), so the WebSocket needs no Cloudflare API call to authorize ----

const TICKET_TTL = 12 * 3600_000
const enc = new TextEncoder()
const b64 = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const hmacKey = (secret: string) =>
  crypto.subtle.importKey('raw', enc.encode(`live:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

export async function signTicket(host: string, secret: string): Promise<string> {
  const exp = Date.now() + TICKET_TTL
  return `${exp}.${b64(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${host}|${exp}`)))}`
}

export async function verifyTicket(host: string, ticket: string, secret: string): Promise<boolean> {
  const [exp, sig] = ticket.split('.')
  if (!sig || !(Number(exp) > Date.now())) return false
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64(sig), enc.encode(`${host}|${exp}`))
  } catch {
    return false
  }
}
