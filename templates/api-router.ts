// Skeleton of the whole backend: one serverless function, one router.
// Copy it, then replace the example routes with your entities.

import { authenticate, requireAdmin } from '../../lib/auth'
import { HttpError } from '../../lib/errors'

export const config = { path: '/api/*' }

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Disposition',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

async function readBody(req: Request): Promise<any> {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

/** Path with the /api (or /.netlify/functions/api) prefix stripped. */
function apiPath(req: Request): string {
  let path = new URL(req.url).pathname
  path = path.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '')
  if (!path.startsWith('/')) path = `/${path}`
  return path.replace(/\/+$/, '') || '/'
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  try {
    return await route(req)
  } catch (e: any) {
    if (e instanceof HttpError) return json({ status: e.status, detail: e.message }, e.status)
    console.error('Unhandled error:', e)
    return json({ status: 500, detail: 'An unexpected error occurred. Check the function logs.' }, 500)
  }
}

async function route(req: Request): Promise<Response> {
  const path = apiPath(req)
  const method = req.method.toUpperCase()

  // ---- unauthenticated routes go FIRST --------------------------------------
  // Public capability links (one-time token) belong here, above the bearer
  // check. Rate-limit them per IP and answer with no-store cache headers.

  // Everything below requires a valid token.
  const user = authenticate(req)

  // Restricted roles: deny by path prefix here, so a route added later is 403
  // by default instead of open. Hiding a tab in the client is not the control.

  // ---- entity ----------------------------------------------------------------
  if (path === '/things' && method === 'GET') return json(await listThings())
  if (path === '/things' && method === 'POST') return json(await createThing(await readBody(req)), 201)

  // A literal sub-path MUST precede the :id match, or "archived" parses as an id.
  if (path === '/things/archived' && method === 'GET') {
    requireAdmin(user)
    return json(await listArchivedThings())
  }

  const thingMatch = path.match(/^\/things\/(\d+)$/)
  if (thingMatch) {
    const id = Number(thingMatch[1])
    requireAdmin(user)
    if (method === 'PUT') return json(await updateThing(id, await readBody(req)))
    // Soft delete: the row stays and can be restored.
    if (method === 'DELETE') {
      await archiveThing(id)
      return noContent()
    }
  }

  throw new HttpError(404, 'Not found.')
}
