import { RANGES } from '../shared/api.ts'
import type { ApiError, Me, Range } from '../shared/api.ts'
import { cfError, cfGet, fetchAnalytics, listSites, toAccounts } from './cloudflare.ts'
import { clearCookie, readToken, sealCookie } from './session.ts'

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
}

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

  // /api/analytics
  const account = url.searchParams.get('account') ?? ''
  const site = url.searchParams.get('site') ?? ''
  const range = url.searchParams.get('range') ?? ''
  if (!/^[0-9a-f]{32}$/.test(account) || !(site === 'all' || /^[0-9a-f]{32}$/.test(site)) || !RANGES.includes(range as Range)) {
    return fail('Invalid account, site or range', 400)
  }
  return json(await fetchAnalytics(token, account, site, range as Range), 200, {
    'Cache-Control': 'private, max-age=60',
  })
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
