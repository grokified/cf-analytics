import type { ApiError as ApiErrorBody } from '../../shared/api'

export class ApiRequestError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Init = { method?: string; json?: unknown; signal?: AbortSignal }

export async function api<T>(path: string, { method, json, signal }: Init = {}): Promise<T> {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
    return (await (await import('../demo')).handle(path)) as T
  }
  const res = await fetch(path, {
    method,
    signal,
    headers: json === undefined ? undefined : { 'content-type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json),
  })
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('unauthorized'))
    throw new ApiRequestError(res.status, (body as ApiErrorBody | null)?.error ?? `Request failed (${res.status})`)
  }
  return body as T
}
