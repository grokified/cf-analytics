import { useEffect, useState } from 'react'
import type { Me } from '../shared/api'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import Dashboard from './Dashboard'
import Login from './Login'

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined) // undefined = loading, null = logged out
  const [bootError, setBootError] = useState('')

  useEffect(() => {
    api<Me>('/api/me')
      .then(setMe)
      .catch((e: Error & { status?: number }) => {
        if (e.status !== 401) setBootError(e.message)
        setMe(null)
      })
    const out = () => setMe(null)
    window.addEventListener('unauthorized', out)
    return () => window.removeEventListener('unauthorized', out)
  }, [])

  if (me === undefined) return <div className="min-h-screen bg-background" />
  return (
    <TooltipProvider>
      {me ? (
        <Dashboard me={me} onLogout={() => api('/api/logout', { method: 'POST', json: {} }).finally(() => setMe(null))} />
      ) : (
        <Login initialError={bootError} onLogin={setMe} />
      )}
    </TooltipProvider>
  )
}
