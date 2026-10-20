// Boots the real Express app on an ephemeral port with every outside
// dependency replaced, so API tests never touch a real database, Google,
// Cloudinary, SMTP or chatbot-service:
//
// - The knex instance (src/lib/db.js) keeps its query builder, but its
//   connection is swapped for a fake that answers each SQL statement from a
//   list of handlers (default: empty result). Tests see exactly which SQL ran.
// - chatbot-service is a tiny local HTTP server recording what it was sent.
// - Env vars that would point at real services are blanked *before* the app
//   is imported (dotenv never overrides a variable that is already set, so
//   backend/.env -- possibly holding the production DATABASE_URL -- is ignored
//   for these keys).
import http from 'node:http'

const BLANK_ENV = [
  'GOOGLE_PLACES_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'GMAIL_USER', 'GMAIL_APP_PASSWORD',
  'CLOUDINARY_URL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'ENABLE_API_DOCS',
]

export const UUID = '11111111-2222-4333-8444-555555555555'
export const USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

export function makeUser(over = {}) {
  return {
    id: USER_ID, email: 'tourist@example.com', display_name: 'Test User', role: 'tourist', status: 'active',
    email_verified: true, points_balance: 100, deleted_at: null, avatar_preset: null, avatar_data: null,
    created_at: '2026-10-01T00:00:00.000Z', ...over,
  }
}

function startChatbotStub() {
  const calls = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null })
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/version') return res.end(JSON.stringify({ version: '9.9.9', sha: 'stubsha' }))
      if (req.url === '/events/extract') return res.end(JSON.stringify({ name: 'งานทดสอบ', extracted: true }))
      if (req.url.startsWith('/admin/reindex')) return res.end(JSON.stringify({ running: false, stub: true }))
      if (req.url === '/admin/places/describe') return res.end(JSON.stringify({ description: 'คำอธิบาย', source: 'stub' }))
      res.statusCode = 404
      res.end(JSON.stringify({ detail: 'not found' }))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, port: server.address().port })))
}

// Fake connection for knex's pg client: `query(config, cb)` is all it calls.
function installFakeDb(db) {
  const state = { queries: [], handlers: [], sessionUser: null }

  function respond(sql, bindings) {
    const lower = sql.trim().toLowerCase()
    if (/^(begin|commit|rollback|savepoint|release savepoint|rollback to savepoint)/.test(lower)) return { command: 'BEGIN', rows: [], rowCount: 0 }
    // requireAuth / requireAdmin / resolveSessionUser
    if (lower.includes('from "sessions" inner join "users"')) {
      const rows = state.sessionUser ? [state.sessionUser] : []
      return { command: 'SELECT', rows, rowCount: rows.length }
    }
    for (const h of state.handlers) {
      if (typeof h.match === 'function' ? h.match(sql, bindings) : h.match.test(sql)) {
        const out = typeof h.reply === 'function' ? h.reply(sql, bindings) : h.reply
        if (out instanceof Error) throw out
        if (Array.isArray(out)) return { command: lower.startsWith('select') || lower.startsWith('with') ? 'SELECT' : lower.split(' ')[0].toUpperCase(), rows: out, rowCount: out.length }
        return out
      }
    }
    if (lower.startsWith('select') || lower.startsWith('with')) {
      // Aggregates always return one row; a bare count of nothing is 0.
      if (/\b(count|sum|max)\(/.test(lower) && !/group by/.test(lower)) {
        return { command: 'SELECT', rows: [{ c: 0, count: 0, n: 0, pts: 0, total: 0 }], rowCount: 1 }
      }
      return { command: 'SELECT', rows: [], rowCount: 0 }
    }
    const command = lower.split(/\s+/)[0].toUpperCase()
    return { command, rows: [], rowCount: 0 }
  }

  const connection = {
    __knexUid: 'fake-connection',
    query(config, cb) {
      const sql = typeof config === 'string' ? config : config.text
      const bindings = typeof config === 'string' ? [] : config.values
      state.queries.push({ sql, bindings })
      let result
      try { result = respond(sql, bindings) } catch (err) { return cb(err) }
      cb(null, result)
    },
  }
  db.client.acquireConnection = async () => connection
  db.client.releaseConnection = async () => {}

  return {
    get queries() { return state.queries },
    /** Answer SQL matching `match` (RegExp or fn) with `reply` (rows array, full pg result, Error, or fn). Later calls win. */
    on(match, reply) { state.handlers.unshift({ match, reply }) },
    /** Who the session cookie resolves to (null = nobody). */
    setSessionUser(user) { state.sessionUser = user },
    reset() { state.queries.length = 0; state.handlers.length = 0; state.sessionUser = null },
  }
}

let harnessPromise
export function startHarness() {
  harnessPromise ??= (async () => {
    const chatbot = await startChatbotStub()
    process.env.NODE_ENV = 'test'
    // Never a real database: nothing listens on port 1, and the fake connection
    // below means no connection is ever opened anyway.
    process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/dino_test_never_used'
    process.env.CHATBOT_SERVICE_URL = `http://127.0.0.1:${chatbot.port}`
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173'
    for (const key of BLANK_ENV) process.env[key] = ''

    const { app } = await import('../../src/app.js')
    const { db } = await import('../../src/lib/db.js')
    const fakeDb = installFakeDb(db)
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const base = `http://127.0.0.1:${server.address().port}`

    async function request(method, path, { body, cookie, headers = {}, form } = {}) {
      const init = { method, headers: { ...headers }, redirect: 'manual' }
      if (cookie) init.headers.cookie = cookie
      if (form) init.body = form
      else if (body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = typeof body === 'string' ? body : JSON.stringify(body)
      }
      const res = await fetch(base + path, init)
      const text = await res.text()
      let json
      try { json = JSON.parse(text) } catch { json = undefined }
      return { status: res.status, headers: res.headers, text, json }
    }

    async function close() {
      // fetch keeps connections alive; close() alone would wait for them to time out.
      server.closeAllConnections()
      chatbot.server.closeAllConnections()
      await new Promise((r) => server.close(r))
      await new Promise((r) => chatbot.server.close(r))
      await db.destroy().catch(() => {})
    }

    return { app, db, fakeDb, chatbot, base, request, close }
  })()
  return harnessPromise
}

// Cookie that makes requireAuth/requireAdmin run their session lookup (which
// the fake DB answers with fakeDb.setSessionUser()).
export const SESSION_COOKIE = 'session_token=test-session-token'
