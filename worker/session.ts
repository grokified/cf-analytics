// Session cookie: base64url(iv[12] || AES-GCM(JSON {token, exp})). Key = SHA-256(SESSION_SECRET).
const COOKIE = 'cfa_session'
const MAX_AGE = 7 * 24 * 3600
const enc = new TextEncoder()

const toB64 = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64 = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function key(secret: string) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function sealCookie(token: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = enc.encode(JSON.stringify({ token, exp: Date.now() + MAX_AGE * 1000 }))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), plain))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return `${COOKIE}=${toB64(out)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

/** Returns the Cloudflare API token from a valid session cookie, else null. */
export async function readToken(request: Request, secret: string): Promise<string | null> {
  const raw = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1]
  if (!raw) return null
  try {
    const buf = fromB64(raw)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf.slice(0, 12) },
      await key(secret),
      buf.slice(12),
    )
    const s = JSON.parse(new TextDecoder().decode(plain))
    return typeof s.token === 'string' && typeof s.exp === 'number' && s.exp > Date.now() ? s.token : null
  } catch {
    return null
  }
}
