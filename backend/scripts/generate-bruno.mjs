// Generates the Bruno collection in backend/bruno/ from backend/openapi.yaml.
//   npm run bruno:generate
// Re-run after changing the spec. Everything under bruno/ except
// environments/*.bru is overwritten (environments are only created if missing,
// so your local passwords survive a regenerate).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(backendDir, 'bruno')
const spec = parse(readFileSync(join(backendDir, 'openapi.yaml'), 'utf8'))
const METHODS = ['get', 'post', 'put', 'patch', 'delete']

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const resolve = (s) => {
  if (!s || !s.$ref) return s
  return s.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], spec)
}
const indent = (text, n = 2) => text.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n')
const safeName = (s) => s.replace(/[\\/:*?"<>|[\]]/g, '').replace(/\s+/g, ' ').trim()

// Path segment -> env var holding a real id to try against.
const ID_VARS = [
  ['/api/admin/place-sync/jobs', 'syncJobId'],
  ['/api/admin/place-sync/places', 'placeId'],
  ['/api/admin/redemptions', 'redemptionId'],
  ['/api/admin/trips', 'tripId'],
  ['/api/admin/event-requests', 'eventRequestId'],
  ['/api/admin/survey', 'surveyResponseId'],
  ['/api/admin/users', 'userId'],
  ['/api/event-requests', 'eventRequestId'],
  ['/api/events', 'eventId'],
  ['/api/places', 'placeId'],
  ['/api/knowledge-base', 'kbId'],
  ['/api/qrs', 'qrId'],
  ['/api/rewards', 'rewardId'],
  ['/api/trips', 'tripId'],
  ['/api/users', 'userId'],
]
function fillPath(path) {
  return path.replace(/\{(\w+)\}/g, (_, name) => {
    if (name === 'photoId') return '{{photoId}}'
    if (name === 'itemId') return '{{tripItemId}}'
    if (name === 'field') return 'name'
    if (name === 'path') return 'trip'
    const hit = ID_VARS.find(([prefix]) => path.startsWith(prefix))
    return `{{${hit ? hit[1] : 'id'}}}`
  })
}

// Example value for a schema: explicit example > default > first enum > a
// placeholder by type. uuid-ish fields point at env vars.
function example(schema, name = '', depth = 0) {
  schema = resolve(schema)
  if (!schema || depth > 6) return null
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s) => example(s, name, depth + 1)))
  if (schema.oneOf) return example(schema.oneOf[0], name, depth + 1)
  if (schema.example !== undefined) return schema.example
  if (schema.format === 'uuid') return `{{${/Id$/.test(name) ? name : 'id'}}}`
  if (schema.default !== undefined) return schema.default
  if (schema.enum) return schema.enum.find((v) => v !== null)
  switch (schema.type) {
    case 'object': {
      if (!schema.properties) return {}
      const out = {}
      for (const [k, v] of Object.entries(schema.properties)) {
        const ex = example(v, k, depth + 1)
        if (ex !== null && ex !== undefined && resolve(v).format !== 'binary') out[k] = ex
      }
      return out
    }
    case 'array': return [example(schema.items, name, depth + 1)].filter((x) => x !== null)
    case 'integer': return schema.minimum ?? 1
    case 'number': return schema.minimum ?? 1
    case 'boolean': return false
    case 'string':
      if (schema.format === 'date') return '2026-11-01'
      if (schema.format === 'date-time') return '2026-11-01T09:00:00.000Z'
      if (schema.format === 'email') return 'user@example.com'
      return name ? `<${name}>` : ''
    default: return null
  }
}

// Hand-written bodies where the schema example alone isn't a working request.
const BODY_OVERRIDES = {
  login: { email: '{{userEmail}}', password: '{{userPassword}}' },
  saveTrip: {
    title: 'ทริปทดสอบจาก Bruno',
    input: { budget_level: 'medium', trip_pace: 'normal', interests: ['คาเฟ่'] },
    days: [{ date: '2026-11-01', dayCostEstimate: 500, dayTravelTimeTotal: 30, items: [{ kind: 'place', placeId: '{{placeId}}', arrivalTime: '09:00', departureTime: '10:30', travelTimeMin: 15, distanceKm: 4.2 }] }],
  },
  scanQr: { lat: 16.4419, lng: 102.8359 },
  adminCreateSyncJob: { scope: 'single', ids: ['{{placeId}}'], dryRun: true },
  adminSyncPreview: { scope: 'filter', filters: { staleDays: 30 }, maxItems: 50 },
  adminSyncOnePlace: { dryRun: true },
  reportPlace: { fields: ['hours'], note: 'ร้านเปิด 10 โมงแล้ว' },
  reportEvent: { fields: ['date'], note: 'เลื่อนเป็นสัปดาห์หน้า' },
  adminResolvePlaceReports: { placeId: '{{placeId}}', field: 'hours', status: 'resolved', resolution: 'edited' },
  adminResolveEventReports: { eventId: '{{eventId}}', field: 'date', status: 'resolved', resolution: 'edited' },
  confirmEmail: { token: '{{token}}' },
  resetPassword: { token: '{{token}}', password: 'NewPassw0rd' },
  confirmEmailChange: { token: '{{token}}' },
  deleteMyAccount: { password: '{{userPassword}}' },
  changePassword: { currentPassword: '{{userPassword}}', newPassword: 'NewPassw0rd' },
  requestEmailChange: { email: 'new-address@example.com', password: '{{userPassword}}' },
}

function successCode(op) {
  return Object.keys(op.responses).find((c) => c.startsWith('2')) || '200'
}

function bruRequest({ name, seq, method, url, body, bodyKind, query = [], headers = [], asserts = [], scriptPost, docs }) {
  const parts = []
  parts.push(`meta {\n  name: ${name}\n  type: http\n  seq: ${seq}\n}`)
  parts.push(`${method.toLowerCase()} {\n  url: ${url}\n  body: ${bodyKind || 'none'}\n  auth: none\n}`)
  if (query.length) parts.push(`params:query {\n${query.map((q) => `  ${q.enabled ? '' : '~'}${q.name}: ${q.value}`).join('\n')}\n}`)
  if (headers.length) parts.push(`headers {\n${headers.map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n}`)
  if (bodyKind === 'json') parts.push(`body:json {\n${indent(JSON.stringify(body, null, 2))}\n}`)
  if (bodyKind === 'multipartForm') parts.push(`body:multipart-form {\n${body.map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n}`)
  if (asserts.length) parts.push(`assert {\n${asserts.map((a) => `  ${a}`).join('\n')}\n}`)
  if (scriptPost) parts.push(`script:post-response {\n${indent(scriptPost)}\n}`)
  if (docs) parts.push(`docs {\n${indent(docs)}\n}`)
  return parts.join('\n\n') + '\n'
}

const AUTH_LABEL = {
  public: 'ไม่ต้องล็อกอิน',
  optional: 'ล็อกอินหรือไม่ก็ได้',
  user: 'ต้องล็อกอิน (รัน "Auth / Login (user)" ก่อน)',
  admin: 'ต้องล็อกอินเป็น admin (รัน "Auth / Login (admin)" ก่อน)',
}

const SAVE_COOKIE = `// Bruno เก็บ cookie ใน cookie jar ให้อัตโนมัติ — สคริปต์นี้เก็บสำเนาไว้ในตัวแปร
// sessionCookie ด้วย เพื่อให้ \`bru run\` (CLI) ส่ง cookie ต่อได้แน่นอน
const raw = res.getHeader("set-cookie");
const first = Array.isArray(raw) ? raw[0] : raw;
if (first) bru.setVar("sessionCookie", String(first).split(";")[0]);`

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------
// Fresh output (keep environments).
if (existsSync(outDir)) {
  for (const entry of readdirSync(outDir)) {
    if (entry !== 'environments') rmSync(join(outDir, entry), { recursive: true, force: true })
  }
}
mkdirSync(join(outDir, 'environments'), { recursive: true })

writeFileSync(join(outDir, 'bruno.json'), JSON.stringify({
  version: '1',
  name: 'Dino Khon Kaen API',
  type: 'collection',
  ignore: ['node_modules', '.git'],
}, null, 2) + '\n')

writeFileSync(join(outDir, 'collection.bru'), `script:pre-request {
  // ส่ง session cookie ที่ได้จาก Login ต่อให้ทุก request (สำหรับ bru run / CLI)
  // ใน Bruno GUI cookie jar ก็ส่งให้อยู่แล้ว ค่าซ้ำกันไม่เป็นปัญหา
  const c = bru.getVar("sessionCookie");
  if (c && !req.getHeader("cookie")) req.setHeader("cookie", c);
}

docs {
  # Dino Khon Kaen API (Bruno)

  สร้างจาก backend/openapi.yaml ด้วย \`npm run bruno:generate\`

  1. เลือก environment **local** แล้วกรอก userEmail/userPassword/adminEmail/adminPassword
  2. รัน **Auth / Login (user)** หรือ **Auth / Login (admin)** ก่อน — cookie session_token จะถูกเก็บใน cookie jar
  3. ใส่ id จริงในตัวแปร (placeId, eventId, ...) ก่อนเรียก endpoint ที่มี id

  ⚠️ request ที่เป็น POST/PUT/PATCH/DELETE เปลี่ยนข้อมูลจริง อย่ารันทั้ง collection กับ production
  โฟลเดอร์ **00 Smoke** อ่านอย่างเดียว ใช้กับ \`bru run "00 Smoke" --env local\` ได้อย่างปลอดภัย
}
`)

const envPath = join(outDir, 'environments', 'local.bru')
if (!existsSync(envPath)) {
  writeFileSync(envPath, `vars {
  baseUrl: http://localhost:4000
  userEmail: tourist@example.com
  userPassword:
  adminEmail: admin@example.com
  adminPassword:
  placeId:
  eventId:
  eventRequestId:
  kbId:
  qrId:
  rewardId:
  tripId:
  tripItemId:
  userId:
  redemptionId:
  surveyResponseId:
  syncJobId:
  photoId:
  token:
}
vars:secret [
  userPassword,
  adminPassword
]
`)
}

const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  METHODS.filter((m) => item[m]).map((m) => ({ path, method: m, op: item[m], pathParams: item.parameters || [] })))

const tagOrder = spec.tags.map((t) => t.name)
const folders = new Map()
let count = 0

for (const tag of tagOrder) {
  const ops = operations.filter((o) => o.op.tags[0] === tag)
  if (!ops.length) continue
  const folderName = `${String(tagOrder.indexOf(tag) + 1).padStart(2, '0')} ${safeName(tag)}`
  const dir = join(outDir, folderName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'folder.bru'), `meta {\n  name: ${folderName}\n  seq: ${tagOrder.indexOf(tag) + 2}\n}\n`)
  folders.set(tag, dir)

  let seq = 1
  // Login helpers live at the top of the Auth folder.
  if (tag === 'Auth') {
    for (const who of ['user', 'admin']) {
      writeFileSync(join(dir, `Login (${who}).bru`), bruRequest({
        name: `Login (${who})`, seq: seq++, method: 'post', url: '{{baseUrl}}/api/auth/login', bodyKind: 'json',
        body: { email: `{{${who}Email}}`, password: `{{${who}Password}}` },
        asserts: ['res.status: eq 200', `res.body.user.email: isString`],
        scriptPost: SAVE_COOKIE,
        docs: `เข้าสู่ระบบด้วยบัญชี ${who} จาก environment แล้วเก็บ cookie \`session_token\`\nrequest ถัด ๆ ไปจะส่ง cookie นี้ให้อัตโนมัติ (Bruno cookie jar)`,
      }))
      count++
    }
  }

  for (const { path, method, op, pathParams } of ops) {
    const params = [...pathParams, ...(op.parameters || [])].map(resolve)
    const query = params.filter((p) => p.in === 'query').map((p) => ({
      name: p.name, enabled: !!p.required, value: p.required ? String(example(p.schema, p.name) ?? '') : String(example(p.schema, p.name) ?? ''),
    }))
    const enabledQs = query.filter((q) => q.enabled).map((q) => `${q.name}=${encodeURIComponent(q.value)}`).join('&')
    const url = `{{baseUrl}}${fillPath(path)}${enabledQs ? `?${enabledQs}` : ''}`

    let bodyKind
    let body
    const content = op.requestBody?.content || {}
    if (content['application/json'] && !content['multipart/form-data']) {
      bodyKind = 'json'
      body = BODY_OVERRIDES[op.operationId] ?? example(content['application/json'].schema) ?? {}
    } else if (content['multipart/form-data']) {
      const schema = resolve(content['multipart/form-data'].schema)
      const parts = schema.allOf ? schema.allOf.map(resolve) : [schema]
      const props = Object.assign({}, ...parts.map((s) => s.properties || {}))
      const required = new Set(parts.flatMap((s) => s.required || []))
      bodyKind = 'multipartForm'
      body = Object.entries(props).map(([k, v]) => {
        const s = resolve(v)
        // Pick the file in Bruno; optional file fields start disabled.
        if (s.format === 'binary') return [`${required.has(k) ? '' : '~'}${k}`, '@file()']
        const ex = example(s, k)
        return [`${['email', 'password', 'title', 'firstName', 'lastName', 'phone', 'gender', 'province', 'district', 'subdistrict', 'birthdate', 'occupation'].includes(k) ? '' : '~'}${k}`, typeof ex === 'object' ? JSON.stringify(ex) : String(ex ?? '')]
      })
    }

    const code = successCode(op)
    const asserts = [`res.status: eq ${code}`]
    const auth = op['x-auth']
    const docs = [
      `## ${op.summary}`,
      '',
      `\`${method.toUpperCase()} ${path}\` · สิทธิ์: ${AUTH_LABEL[auth]}`,
      '',
      (op.description || '').trim(),
      '',
      `คาดหวัง: HTTP ${code} เมื่อสำเร็จ · error ตอบเป็น \`{ "error": { "message": "..." } }\``,
    ].join('\n').replace(/\n{3,}/g, '\n\n')

    const isLogout = op.operationId === 'logout'
    const file = `${String(seq).padStart(2, '0')} ${safeName(op.summary.replace(/^\[Admin\]\s*/, ''))}.bru`
    writeFileSync(join(dir, file), bruRequest({
      name: safeName(op.summary), seq: seq++, method, url, body, bodyKind, query: query.filter((q) => !q.enabled),
      asserts, docs,
      scriptPost: op.operationId === 'login' || op.operationId === 'confirmEmail' || op.operationId === 'resetPassword'
        ? SAVE_COOKIE
        : isLogout ? 'bru.setVar("sessionCookie", "");' : undefined,
    }))
    count++
  }
}

// ---------------------------------------------------------------------------
// 00 Smoke: read-only checks that are safe for `bru run` against any server.
// ---------------------------------------------------------------------------
const smokeDir = join(outDir, '00 Smoke')
mkdirSync(smokeDir, { recursive: true })
writeFileSync(join(smokeDir, 'folder.bru'), 'meta {\n  name: 00 Smoke\n  seq: 1\n}\n')
const smoke = [
  ['Health', 'get', '/api/health', ['res.status: eq 200', 'res.body.status: eq ok']],
  ['Places list (public)', 'get', '/api/places?isActive=true&page=1&limit=5', ['res.status: eq 200', 'res.body.data: isArray', 'res.body.page: eq 1']],
  ['Events list (public)', 'get', '/api/events?page=1&limit=5', ['res.status: eq 200', 'res.body.data: isArray']],
  ['Rewards list (public)', 'get', '/api/rewards', ['res.status: eq 200', 'res.body: isArray']],
  ['QR places (public)', 'get', '/api/qrs/meta/places', ['res.status: eq 200', 'res.body: isArray']],
  ['Survey questions', 'get', '/api/survey/questions', ['res.status: eq 200', 'res.body.questions: isArray']],
  ['Me without session is null', 'get', '/api/auth/me', ['res.status: eq 200', 'res.body.user: isNull']],
  ['Profile requires login (401)', 'get', '/api/profile', ['res.status: eq 401', 'res.body.error.message: eq กรุณาเข้าสู่ระบบก่อน']],
  ['Admin stats requires login (401)', 'get', '/api/admin/stats', ['res.status: eq 401']],
  ['Login validation (400)', 'post', '/api/auth/login', ['res.status: eq 400', 'res.body.error.message: eq กรุณากรอกอีเมลและรหัสผ่าน'], { email: 'smoke@example.com' }],
  ['Unknown route (404)', 'get', '/api/does-not-exist', ['res.status: eq 404']],
  ['robots.txt', 'get', '/robots.txt', ['res.status: eq 200']],
]
smoke.forEach(([name, method, path, asserts, body], i) => {
  writeFileSync(join(smokeDir, `${String(i + 1).padStart(2, '0')} ${safeName(name)}.bru`), bruRequest({
    name, seq: i + 1, method, url: `{{baseUrl}}${path}`, asserts,
    bodyKind: body ? 'json' : undefined, body,
    docs: 'ชุดตรวจแบบอ่านอย่างเดียว ไม่ต้องล็อกอิน รันได้ด้วย `bru run "00 Smoke" --env local`',
  }))
  count++
})

console.log(`Bruno collection written to ${outDir}: ${count} requests in ${folders.size + 1} folders`)
