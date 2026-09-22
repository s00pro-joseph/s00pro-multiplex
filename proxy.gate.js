// ============================================================================
// CORSAPI — Bun front door (THE GATE)
//
// This file deliberately contains NO proxy logic.
//
//   player ──control paths──> Bun (auth) ──> Worker ──> upstream
//   player ──video segments────────────────> Worker ──> upstream
//
// Everything hard lives in the Worker: m3u8 rewriting, header fallbacks,
// method/body passthrough, edge caching, LunaTV config output. There is no
// helper function shared between the two files, so there is nothing to drift.
//
// Why a gate at all? It keeps the Worker's address off the public internet.
// The Worker is allowlisted (ALLOWED_HOSTS) so it cannot be used as an open
// relay, but an unlisted URL is still meaningfully safer than a public one —
// abuse has to leak out of a device before anyone can try.
//
// ---------------------------------------------------------------------------
// ENVIRONMENT (required)
//
//   WORKER_ORIGIN = "https://your-worker.workers.dev"
//   AUTH_TOKEN    = "a long random string"
//   PORT          = 8080            (optional)
//   RATE_LIMIT    = 120             (optional, requests per minute per token)
//
// Run with Tailscale: the base URL advertised to clients is derived from the
// incoming Host header, so a phone hitting http://box.tailnet:8080 is handed
// links that point back at itself rather than at localhost.
// ============================================================================

const PORT = Number(process.env.PORT || 8080)
const WORKER_ORIGIN = (process.env.WORKER_ORIGIN || '').replace(/\/+$/, '')
const AUTH_TOKEN = process.env.AUTH_TOKEN || ''
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 120)
const RATE_WINDOW_MS = 60_000

if (!WORKER_ORIGIN) {
  console.error('FATAL: WORKER_ORIGIN is not set. Example: WORKER_ORIGIN=https://x.workers.dev')
  process.exit(1)
}

if (!AUTH_TOKEN || AUTH_TOKEN.length < 16) {
  console.error('FATAL: AUTH_TOKEN is missing or too short (16+ chars required).')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Hop-by-hop headers — never forwarded in either direction.
// origin/referer are dropped outbound on purpose: the Worker derives correct
// ones from the *target* host. Forwarding the browser's would leak localhost
// to upstreams and trip Referer checks.
// ---------------------------------------------------------------------------

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
  'host', 'origin', 'referer', 'cookie', 'content-length',
  'cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-real-ip',
])

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, X-Cache',
  'Access-Control-Max-Age': '86400',
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Constant-time compare so a wrong token can't be discovered byte by byte.
function tokenMatches(candidate) {
  if (typeof candidate !== 'string' || candidate.length !== AUTH_TOKEN.length) return false
  let diff = 0
  for (let i = 0; i < AUTH_TOKEN.length; i++) {
    diff |= candidate.charCodeAt(i) ^ AUTH_TOKEN.charCodeAt(i)
  }
  return diff === 0
}

function extractToken(req, url) {
  const header = req.headers.get('authorization')
  if (header && /^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, '')
  const alt = req.headers.get('x-auth-token')
  if (alt) return alt
  return url.searchParams.get('token')
}

// ---------------------------------------------------------------------------
// Rate limit — in-memory, per token. A leaked token still can't be hammered
// from the open internet. Single process, so this is best-effort by design.
// ---------------------------------------------------------------------------

const hits = new Map()

function rateLimited(key) {
  const now = Date.now()
  const entry = hits.get(key)
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return false
  }
  entry.count += 1
  return entry.count > RATE_LIMIT
}

// Sweep expired buckets so the Map can't grow without bound — the old server
// only deleted on read, so anything never requested again leaked forever.
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of hits) {
    if (now > entry.resetAt) hits.delete(key)
  }
}, RATE_WINDOW_MS).unref?.()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extra },
  })
}

function filterHeaders(source, extraBlocked = []) {
  const out = new Headers()
  const blocked = new Set([...HOP_BY_HOP, ...extraBlocked])
  for (const [key, value] of source) {
    if (!blocked.has(key.toLowerCase())) out.set(key, value)
  }
  return out
}

// The origin clients should use to reach *this* server. Derived from Host so
// it works over Tailscale, a reverse proxy, or plain localhost.
function publicOrigin(req, url) {
  const forwardedHost = req.headers.get('x-forwarded-host')
  const host = forwardedHost || req.headers.get('host')
  if (host) {
    const proto = req.headers.get('x-forwarded-proto') || (url.protocol === 'https:' ? 'https' : 'http')
    return `${proto}://${host}`
  }
  return url.origin
}

function landingPage(origin) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CORSAPI — gate</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--g:#22C55E;--gd:#10B981;--bg:#0F1117;--c:#1F2937;--bd:#374151;--s:#9ca3af}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:#fff;line-height:1.6;padding:24px 16px}
  .w{max-width:760px;margin:0 auto}
  .top{display:flex;align-items:center;gap:8px;margin-bottom:20px}
  .logo{width:28px;height:28px;border-radius:6px;background:linear-gradient(135deg,var(--g),var(--gd));display:flex;align-items:center;justify-content:center;font-weight:800;color:#052e16}
  .brand{font-size:16px;font-weight:700}
  .pill{margin-left:auto;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;background:rgba(34,197,94,.12);color:var(--g)}
  .box{background:var(--c);border:1px solid var(--bd);border-radius:12px;padding:18px 22px;margin-bottom:14px}
  h1{font-size:23px;font-weight:800;margin-bottom:6px}
  h2{font-size:15px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:10px}
  h2::before{content:"";width:3px;height:14px;background:linear-gradient(180deg,var(--g),var(--gd));border-radius:2px}
  p{color:var(--s);font-size:14px}
  code{background:rgba(34,197,94,.12);color:var(--g);padding:2px 6px;border-radius:4px;font-family:Consolas,monospace;font-size:13px}
  pre{background:#0b0e14;border:1px solid var(--bd);border-radius:8px;padding:14px 16px;margin:10px 0;overflow-x:auto;font-family:Consolas,monospace;font-size:12.5px;color:#d1d5db}
  .kv{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--bd);font-size:14px;color:var(--s)}
  .kv:last-child{border:0}
  .kv b{color:#fff;font-weight:600}
</style>
</head>
<body><div class="w">
  <div class="top">
    <div class="logo">C</div><span class="brand">CORSAPI gate</span>
    <span class="pill">running</span>
  </div>

  <div class="box">
    <h1>Gate is up</h1>
    <p>Authenticating and forwarding to the edge Worker. All proxy logic lives there.</p>
  </div>

  <div class="box">
    <h2>Status</h2>
    <div class="kv"><span>Listening on</span><b>:${PORT}</b></div>
    <div class="kv"><span>Worker upstream</span><b>${WORKER_ORIGIN}</b></div>
    <div class="kv"><span>Clients should use</span><b>${origin}</b></div>
    <div class="kv"><span>Rate limit</span><b>${RATE_LIMIT}/min per token</b></div>
  </div>

  <div class="box">
    <h2>Client usage</h2>
    <pre>GET ${origin}/m3u8?url=https://cdn.example.com/index.m3u8
Authorization: Bearer &lt;AUTH_TOKEN&gt;

or append: ?token=&lt;AUTH_TOKEN&gt;</pre>
    <p>Video segments are served by the Worker directly, so players only need the token on control requests. If your player cannot send headers, use the <code>?token=</code> form.</p>
  </div>
</div></body>
</html>`
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,

  async fetch(request) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const origin = publicOrigin(request, url)

    if (url.pathname === '/health') {
      return jsonResponse({ status: 'ok', worker: WORKER_ORIGIN }, 200)
    }

    // Landing page is for humans only. If a ?url= target is present the
    // request is a relay call and must be forwarded, not swallowed.
    if (url.pathname === '/' && !url.searchParams.has('url')) {
      return new Response(landingPage(origin), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
      })
    }

    // --- auth ---
    const token = extractToken(request, url)
    if (!tokenMatches(token)) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const bucketKey = token.slice(0, 8)
    if (rateLimited(bucketKey)) {
      return jsonResponse({ error: 'Rate limit exceeded' }, 429, { 'Retry-After': '60' })
    }

    // --- loop guard: never forward to ourselves ---
    if (origin === WORKER_ORIGIN) {
      return jsonResponse({ error: 'Loop detected: WORKER_ORIGIN equals this server' }, 500)
    }

    // --- forward ---
    const target = new URL(url.pathname + url.search, WORKER_ORIGIN)
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'

    try {
      const upstream = await fetch(target.toString(), {
        method: request.method,
        headers: filterHeaders(request.headers),
        body: hasBody ? await request.arrayBuffer() : undefined,
      })

      const headers = filterHeaders(upstream.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)

      // Stream straight through. Never arrayBuffer() here — this path can
      // carry manifests and, if ever used for media, large bodies.
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      })
    } catch (err) {
      return jsonResponse(
        { error: 'Worker unreachable', message: err.message, worker: WORKER_ORIGIN },
        502
      )
    }
  },
})

console.log(`CORSAPI gate listening on http://localhost:${server.port}`)
console.log(`Forwarding to ${WORKER_ORIGIN}`)
