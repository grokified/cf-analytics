import { useEffect, useState } from 'react'
import type { Me } from '../shared/api'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import Dashboard from './Dashboard'
import Login from './Login'
import Logs from './Logs'

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined) // undefined = loading, null = logged out
  const [bootError, setBootError] = useState('')
  const [path, setPath] = useState(location.pathname)

  const navigate = (to: string) => {
    const p = new URLSearchParams(location.search)
    const keep = new URLSearchParams()
    for (const k of ['account', 'site', 'demo']) if (p.has(k)) keep.set(k, p.get(k)!)
    history.pushState(null, '', `${to}${keep.size ? `?${keep}` : ''}`)
    setPath(to)
  }

  useEffect(() => {
    api<Me>('/api/me')
      .then(setMe)
      .catch((e: Error & { status?: number }) => {
        if (e.status !== 401) setBootError(e.message)
        setMe(null)
      })
    const out = () => setMe(null)
    window.addEventListener('unauthorized', out)
    const pop = () => setPath(location.pathname)
    window.addEventListener('popstate', pop)
    return () => {
      window.removeEventListener('unauthorized', out)
      window.removeEventListener('popstate', pop)
    }
  }, [])

  if (me === undefined) return <div className="min-h-screen bg-background" />
  const logout = () => api('/api/logout', { method: 'POST', json: {} }).finally(() => setMe(null))
  const Page = path === '/logs' ? Logs : Dashboard
  return (
    <TooltipProvider>
      {me ? (
        <Page me={me} onLogout={logout} onNavigate={navigate} />
      ) : (
        <Login initialError={bootError} onLogin={setMe} />
      )}
    </TooltipProvider>
  )
}
