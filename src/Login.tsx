import { useState } from 'react'
import { Activity } from 'lucide-react'
import type { Me } from '../shared/api'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

const TOKEN_URL =
  'https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22account_analytics%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22analytics%22%2C%22type%22%3A%22read%22%7D%5D&accountId=*&zoneId=all&name=Web%20Analytics%20Dashboard'

export default function Login({ initialError, onLogin }: { initialError: string; onLogin: (me: Me) => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState(initialError)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onLogin(await api<Me>('/api/login', { method: 'POST', json: { token: token.trim() } }))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-card">
          <Activity className="size-5" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Log in to Web Analytics</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect your Cloudflare account with an API token. It's kept encrypted in an HTTP-only cookie.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Cloudflare API token"
            autoComplete="off"
            spellCheck={false}
            required
            className="h-10 rounded-md border-border bg-card px-3 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={busy || !token.trim()}
            className="h-10 w-full rounded-md bg-[#ededed] text-sm font-medium text-[#0a0a0a] transition-colors hover:bg-white disabled:opacity-50"
          >
            {busy ? 'Connecting…' : 'Continue with Cloudflare'}
          </button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <div className="mt-6 text-sm">
          <a href={TOKEN_URL} target="_blank" rel="noreferrer" className="text-foreground hover:underline">
            Create a token with the right permissions ↗
          </a>
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            <li>Account Analytics: Read</li>
            <li>Account Settings: Read</li>
            <li>Zone Analytics: Read (request logs)</li>
            <li className="opacity-60">Optional: Account › Workers Observability › Edit (runtime logs)</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
