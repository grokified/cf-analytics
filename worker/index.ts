import { RANGES } from '../shared/api.ts'
import type { ApiError, LiveTicket, Me, Range } from '../shared/api.ts'
import { cfError, cfGet, fetchAnalytics, listSites, toAccounts } from './cloudflare.ts'
import { LogError, requestLogs, runtimeLogs } from './logs.ts'
import { cleanPath, normHost, signTicket, verifyTicket } from './presence.ts'
import { clearCookie, readToken, sealCookie } from './session.ts'

export { Presence } from './presence.ts'

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers })
const fail = (error: string, status: number, headers?: Record<string, string>) =>
  json({ error } satisfies ApiError, status, headers)

const ROUTES: Record<string, string> = {
  '/api/login': 'POST',
  '/api/logout': 'POST',
  '/api/me': 'GET',
  '/api/sites': 'GET',
  '/api/analytics': 'GET',
  '/api/logs/requests': 'GET',
  '/api/logs/runtime': 'GET',
  '/api/live/tickets': 'GET',
  '/api/live': 'GET',
  '/api/rt': 'GET',
}

const presence = (env: Env, host: string) => env.PRESENCE.get(env.PRESENCE.idFromName(host))

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const method = ROUTES[url.pathname]
  if (!method) return fail('Not found', 404)
  if (request.method !== method) return fail('Method not allowed', 405, { Allow: method })

  if (method === 'POST') {
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
      return fail('Content-Type must be application/json', 415)
    }
    const origin = request.headers.get('origin')
    if (origin && origin !== url.origin) return fail('Cross-origin request blocked', 403)
  }

  // Live sockets. Neither needs the session cookie: visitors are anonymous, dashboards carry a signed ticket.
  if (url.pathname === '/api/rt' || url.pathname === '/api/live') {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return fail('Expected a WebSocket upgrade', 426)
    let origin = ''
    try {
      origin = new URL(request.headers.get('origin') ?? '').hostname
    } catch {
      // missing or malformed Origin
    }

    if (url.pathname === '/api/rt') {
      const site = normHost(url.searchParams.get('site') ?? '')
      if (!site || !(origin === site || origin.endsWith(`.${site}`))) return fail('Origin not allowed', 403)
      const q = new URLSearchParams({
        p: cleanPath(url.searchParams.get('p')),
        c: String((request.cf as { country?: string } | undefined)?.country ?? ''),
      })
      return presence(env, site).fetch(`https://presence/visitor?${q}`, { headers: { Upgrade: 'websocket' } })
    }

    const host = normHost(url.searchParams.get('host') ?? '')
    if (origin !== url.hostname) return fail('Cross-origin request blocked', 403)
    if (!host || !(await verifyTicket(host, url.searchParams.get('t') ?? '', env.SESSION_SECRET))) {
      return fail('Invalid or expired live ticket', 401)
    }
    return presence(env, host).fetch('https://presence/dashboard', { headers: { Upgrade: 'websocket' } })
  }

  if (url.pathname === '/api/logout') return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookie } })

  if (url.pathname === '/api/login') {
    const body: any = await request.json().catch(() => null)
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) return fail('Invalid token format', 400)

    const accts = await cfGet(token, '/accounts?per_page=50')
    if (!accts.ok || !accts.body.result?.length) {
      const m = cfError(accts)
      return fail(m ? `Cloudflare rejected this token: ${m}` : 'Cloudflare rejected this token', 401)
    }
    const accounts = toAccounts(accts)
    const probe = await cfGet(token, `/accounts/${accounts[0].id}/rum/site_info/list?per_page=1`)
    if (!probe.ok) return fail('Token needs Account Settings: Read to list Web Analytics sites', 403)

    return json({ accounts } satisfies Me, 200, { 'Set-Cookie': await sealCookie(token, env.SESSION_SECRET) })
  }

  const token = await readToken(request, env.SESSION_SECRET)
  if (!token) return fail('Not signed in', 401)

  if (url.pathname === '/api/me') {
    const r = await cfGet(token, '/accounts?per_page=50')
    if (r.status === 401 || r.status === 403) return fail('Not signed in', 401, { 'Set-Cookie': clearCookie })
    if (!r.ok) return fail('Cloudflare request failed', 502)
    return json({ accounts: toAccounts(r) } satisfies Me)
  }

  const accts = await cfGet(token, '/accounts?per_page=50')
  if (accts.status === 401 || accts.status === 403) return fail('Not signed in', 401, { 'Set-Cookie': clearCookie })

  if (url.pathname === '/api/sites') {
    if (!accts.ok) return fail('Cloudflare request failed', 502)
    return json(await listSites(token, toAccounts(accts)))
  }

  if (url.pathname === '/api/live/tickets') {
    if (!accts.ok) return fail('Cloudflare request failed', 502)
    const account = toAccounts(accts).find((a) => a.id === url.searchParams.get('account'))
    const site = url.searchParams.get('site') ?? ''
    if (!account || !(site === 'all' || /^[0-9a-f]{32}$/.test(site))) return fail('Invalid account or site', 400)
    const hosts = new Set(
      (await listSites(token, [account]))
        .filter((s) => site === 'all' || s.siteTag === site)
        .map((s) => normHost(s.host))
        .filter(Boolean),
    )
    const tickets = await Promise.all([...hosts].map(async (host) => ({ host, ticket: await signTicket(host, env.SESSION_SECRET) })))
    return json(tickets satisfies LiveTicket[], 200, { 'Cache-Control': 'no-store' })
  }

  if (url.pathname.startsWith('/api/logs/')) {
    try {
      const page = url.pathname === '/api/logs/requests' ? await requestLogs(token, url) : await runtimeLogs(token, url)
      return json(page, 200, { 'Cache-Control': 'no-store' })
    } catch (e) {
      if (e instanceof LogError) return fail(e.message, e.status)
      throw e
    }
  }

  // /api/analytics
  const account = url.searchParams.get('account') ?? ''
  const site = url.searchParams.get('site') ?? ''
  const range = url.searchParams.get('range') ?? ''
  if (!/^[0-9a-f]{32}$/.test(account) || !(site === 'all' || /^[0-9a-f]{32}$/.test(site)) || !RANGES.includes(range as Range)) {
    return fail('Invalid account, site or range', 400)
  }
  // no-store: a cached copy made the Refresh button and the online count stale for up to a minute.
  return json(await fetchAnalytics(token, account, site, range as Range), 200, { 'Cache-Control': 'no-store' })
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env)
    } catch (e) {
      // Messages from cloudflare.ts never contain the token.
      return fail(e instanceof Error ? e.message : 'Upstream error', 502)
    }
  },
} satisfies ExportedHandler<Env>
