// The ONLY module in the client that calls fetch. Views import `api`.

const API_BASE: string = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8888'
const TOKEN_KEY = 'app_token'

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY) }
export function setToken(token: string) { localStorage.setItem(TOKEN_KEY, token) }
export function clearToken() { localStorage.removeItem(TOKEN_KEY) }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: () => void) { onUnauthorized = handler }

async function detailOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    return body?.detail ?? fallback
  } catch {
    return fallback // non-JSON error body
  }
}

/** Authenticated calls. A 401 ends the session. */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (res.status === 401) {
    clearToken()
    onUnauthorized?.()
    throw new ApiError(401, 'Session expired — please log in again.')
  }
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, `Request failed (${res.status})`))
  return res
}

/**
 * Public capability links are intentionally unauthenticated and MUST NOT share
 * request(): otherwise an expired client token logs the staff user out.
 */
export async function publicRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, `Request failed (${res.status})`))
  return res
}

const realApi = {
  async login(username: string, password: string) {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    const data = await res.json()
    setToken(data.accessToken)
    return data
  },

  logout() { clearToken() },

  async me() {
    return (await request('/api/auth/me')).json()
  },

  async listThings() {
    return (await request('/api/things')).json()
  },

  async createThing(input: unknown) {
    return (await request('/api/things', { method: 'POST', body: JSON.stringify(input) })).json()
  },

  async archiveThing(id: number) {
    await request(`/api/things/${id}`, { method: 'DELETE' })
  },
}

export type Api = typeof realApi

// Swap in a dev-only in-memory implementation here (see mockApi.ts in the
// reference app) so the UI can be worked on without the function or the store.
export const api: Api = realApi

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
