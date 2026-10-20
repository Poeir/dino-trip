// openapi.yaml <-> Express consistency, plus auth checks generated from the
// spec: every operation marked `x-auth: user|admin` must answer 401 without a
// session, and every `x-auth: admin` one 403 for a logged-in tourist.
// Runs against the real app with a fake DB (see helpers/apiHarness.js).
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { startHarness, makeUser, UUID, SESSION_COOKIE } from './helpers/apiHarness.js'

const spec = parse(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'))
const h = await startHarness()
after(() => h.close())

const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  METHODS.filter((m) => item[m]).map((m) => ({ path, method: m.toUpperCase(), op: item[m] })))

// ---------------------------------------------------------------------------
// Express route table -> "METHOD /openapi/{style}" strings
// ---------------------------------------------------------------------------
function mountPath(layer) {
  if (layer.regexp.fast_slash) return ''
  return layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\\\//g, '/')
}

function toSpecPath(p) {
  let out = p.replace(/:(\w+)/g, '{$1}').replace(/\/\*$/, '/{path}')
  if (out.length > 1) out = out.replace(/\/$/, '')
  return out || '/'
}

function expressRoutes(stack, prefix = '', out = new Set()) {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]
      for (const p of paths) {
        for (const m of Object.keys(layer.route.methods)) {
          if (m !== '_all') out.add(`${m.toUpperCase()} ${toSpecPath(prefix + p)}`)
        }
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      expressRoutes(layer.handle.stack, prefix + mountPath(layer), out)
    }
  }
  return out
}

// Dev-only Swagger UI routes are documentation about the spec, not part of it.
const isDocsRoute = (key) => key.split(' ')[1].startsWith('/api/docs')

test('every Express route is documented in openapi.yaml', () => {
  const documented = new Set(operations.map((o) => `${o.method} ${o.path}`))
  const routes = [...expressRoutes(h.app._router.stack)].filter((k) => !isDocsRoute(k))
  assert.ok(routes.length > 100, `expected the full route table, got ${routes.length}`)
  const missing = routes.filter((r) => !documented.has(r))
  assert.deepEqual(missing, [], `routes missing from openapi.yaml:\n${missing.join('\n')}`)
})

test('every documented operation exists in Express', () => {
  const routes = expressRoutes(h.app._router.stack)
  const extra = operations.map((o) => `${o.method} ${o.path}`).filter((k) => !routes.has(k))
  assert.deepEqual(extra, [], `documented but not routed:\n${extra.join('\n')}`)
})

test('operations are well-formed: unique operationId, tag, x-auth and matching security', () => {
  const ids = new Set()
  const tagNames = new Set(spec.tags.map((t) => t.name))
  for (const { path, method, op } of operations) {
    const where = `${method} ${path}`
    assert.ok(op.operationId, `${where} has no operationId`)
    assert.ok(!ids.has(op.operationId), `duplicate operationId ${op.operationId}`)
    ids.add(op.operationId)
    assert.ok(op.summary, `${where} has no summary`)
    assert.ok(op.tags?.length && op.tags.every((t) => tagNames.has(t)), `${where} has an unknown tag`)
    assert.ok(['public', 'optional', 'user', 'admin'].includes(op['x-auth']), `${where} has no valid x-auth`)
    const usesCookie = (op.security || []).some((s) => 'cookieAuth' in s)
    if (op['x-auth'] === 'public') assert.ok(!usesCookie, `${where} is public but declares cookieAuth`)
    else assert.ok(usesCookie, `${where} needs a session but has no cookieAuth security`)
    if (op['x-auth'] === 'admin') assert.match(op.summary, /^\[Admin\]/, `${where} admin summary should start with [Admin]`)
    for (const code of Object.keys(op.responses)) assert.match(code, /^[1-5]\d\d$/, `${where} bad status ${code}`)
  }
})

const fillPath = (path) => path.replace(/\{(\w+)\}/g, (_, name) => (name === 'field' ? 'name' : name === 'path' ? 'trip' : UUID))

test('x-auth user/admin operations answer 401 without a session cookie', async () => {
  h.fakeDb.reset()
  const protectedOps = operations.filter((o) => o.op['x-auth'] === 'user' || o.op['x-auth'] === 'admin')
  assert.ok(protectedOps.length > 80)
  for (const { path, method } of protectedOps) {
    const res = await h.request(method, fillPath(path), method === 'GET' || method === 'DELETE' ? {} : { body: {} })
    assert.equal(res.status, 401, `${method} ${path} -> ${res.status} ${res.text}`)
    assert.equal(res.json?.error?.message, 'กรุณาเข้าสู่ระบบก่อน', `${method} ${path}`)
  }
  // 401s are decided before any query: no cookie, no DB access.
  assert.equal(h.fakeDb.queries.length, 0)
})

test('x-auth admin operations answer 403 for a logged-in tourist', async () => {
  h.fakeDb.reset()
  h.fakeDb.setSessionUser(makeUser({ role: 'tourist' }))
  const adminOps = operations.filter((o) => o.op['x-auth'] === 'admin')
  assert.ok(adminOps.length > 50)
  for (const { path, method } of adminOps) {
    const res = await h.request(method, fillPath(path), { cookie: SESSION_COOKIE, ...(method === 'GET' || method === 'DELETE' ? {} : { body: {} }) })
    assert.equal(res.status, 403, `${method} ${path} -> ${res.status} ${res.text}`)
    assert.equal(res.json?.error?.message, 'ไม่มีสิทธิ์เข้าถึงส่วนนี้', `${method} ${path}`)
  }
  // Only the session lookups ran -- nothing past requireAdmin touched the DB.
  assert.ok(h.fakeDb.queries.every((q) => q.sql.includes('from "sessions"')))
})

test('a session cookie that no longer resolves is treated as logged out (and cleared)', async () => {
  h.fakeDb.reset()
  const res = await h.request('GET', '/api/points/me', { cookie: SESSION_COOKIE })
  assert.equal(res.status, 401)
  assert.match(res.headers.get('set-cookie') || '', /session_token=;/)
})
