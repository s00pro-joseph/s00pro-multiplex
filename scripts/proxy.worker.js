// ============================================================================
// CORSAPI — Cloudflare Worker (THE ENGINE)
//
// This file owns ALL of the hard logic:
//   - m3u8 fetch + full segment/variant rewriting
//   - Referer / Origin / User-Agent fallbacks per upstream
//   - method + body passthrough (POST/PUT/DELETE)
//   - edge caching (CF cache API + cf options)
//   - LunaTV config output (?format=)
//
// Bun server.js is a THIN AUTH GATE that forwards here. It intentionally
// contains NONE of the above, so there is nothing to keep in sync.
//
// ---------------------------------------------------------------------------
// DEPLOY SETTINGS
//
//   BINDING:  KV namespace bound as "KV" (wrangler or dashboard). Holds the
//             allowlist plus m3u8/JSON caches.
//
//   SECRET:   ADMIN_TOKEN = "a long random string"
//             Guards POST /admin/hosts. Off = admin stays closed.
//
//   SECRET (bootstrap): ALLOWED_HOSTS = "example.com,foo.net,cdn.io"
//             Seed list used until the first POST /admin/hosts. Also the
//             recovery path if KV is ever wiped. Empty = fail closed.
//
// Manage hosts at runtime — no git, no redeploy, no polling timer:
//
//   curl -X POST https://<worker>.workers.dev/admin/hosts \
//     -H "x-admin-token: $ADMIN_TOKEN" --data-binary @corsapi-hosts.txt
//
//   curl https://<worker>.workers.dev/admin/hosts \
//     -H "x-admin-token: $ADMIN_TOKEN"
//
// Every request reads the live KV value, so an edit applies immediately.
//

// KV is the primary layer for m3u8 + JSON (same keys and TTLs as the
// pre-rewrite build, so older entries stay valid). caches.default remains as
// the fallback where no KV binding exists, and for segments. Solo localhost
// use sits far below the KV free-tier write cap (~6 writes per play); if
// writes ever error, caching degrades to misses — never an outage.
//
// ALLOWED_HOSTS is the ONLY thing standing between this Worker and a ban.
// Without it the Worker is an open proxy: anyone who learns its address can
// make Cloudflare fetch arbitrary URLs, and abuse gets traced to your account.
// It FAILS CLOSED on purpose. Include every media + API host you need.
//
// Add a plain host to match it and all its subdomains.
// Prefix with a dot (".example.com") to match subdomains ONLY.
// Use an exact host (no dot) to match that host and its subdomains.
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    // Pages Functions surface bindings on env; Workers use globals.
    if (env && env.KV && typeof globalThis.KV === 'undefined') {
      globalThis.KV = env.KV
    }
    return handleRequest(request, env, ctx || {})
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, x-auth-token',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, X-Cache',
  'Access-Control-Max-Age': '86400',
}

// Hop-by-hop plus framing headers. content-encoding/content-length must go
// because Workers may hand back a decoded body while the header still claims
// the original encoding.
const EXCLUDE_HEADERS = new Set([
  'content-encoding', 'content-length', 'transfer-encoding',
  'connection', 'keep-alive', 'set-cookie', 'set-cookie2',
  'host', 'cf-ray', 'cf-connecting-ip', 'cf-worker',
])

const JSON_SOURCES = {
  'jin18': 'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/jin18.json',
  'jingjian': 'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/jingjian.json',
  'full': 'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/LunaTV-config.json',
}

const FORMAT_CONFIG = {
  '0': { proxy: false, base58: false },
  'raw': { proxy: false, base58: false },
  '1': { proxy: true, base58: false },
  'proxy': { proxy: true, base58: false },
  '2': { proxy: false, base58: true },
  'base58': { proxy: false, base58: true },
  '3': { proxy: true, base58: true },
  'proxy-base58': { proxy: true, base58: true },
}

// Cache lifetimes, in seconds. Applied via Cache-Control on the response we
// store, because caches.default honours it (and refuses to store no-store).
const TTL_JSON = 600   // 10 min — LunaTV configs change rarely
const TTL_M3U8 = 300   // 5 min  — balances "line switched" vs "replay cost"
const TTL_SEGMENT = 3600

const TIMEOUT_SEGMENT = 30000
const TIMEOUT_MANIFEST = 15000

const MAX_SPEED_TEST_MB = 3   // higher allocations trip CF edge backpressure

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

// ---------------------------------------------------------------------------
// Edge cache — built in, free, zero configuration
// ---------------------------------------------------------------------------

// Synthetic origin for cache keys. The real upstream URL is preserved verbatim
// as the path so entries stay debuggable and never collide with a real host.
const CACHE_ORIGIN = 'https://corsapi.internal'

function cacheKey(url) {
  return new Request(url, { method: 'GET' })
}

function namespacedKey(namespace, identity) {
  return new Request(`${CACHE_ORIGIN}/${namespace}/${encodeURIComponent(identity)}`, { method: 'GET' })
}

// Reads never throw outward: an unavailable cache must degrade to a slow
// response, not an error page.
async function cacheMatch(key) {
  try {
    return await caches.default.match(key)
  } catch {
    return undefined
  }
}

// Writes are fire-and-forget via waitUntil so the Worker can answer the client
// without waiting on the cache. Refuses 206 / no-store bodies, so we always
// store a header-normalised clone.
function cacheStore(ctx, key, response, ttl) {
  try {
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', `public, max-age=${ttl}`)
    headers.delete('Pragma')
    const storeable = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
    ctx.waitUntil(caches.default.put(key, storeable))
  } catch {
    // Cache is an optimisation. Never let a failed put break the request.
  }
}

// ---------------------------------------------------------------------------
// Workers KV — primary layer for m3u8 + JSON. Keys match the pre-rewrite
// format so entries written by older deploys stay valid. Reads never throw;
// writes go through waitUntil. Where no KV binding exists every helper
// degrades to null/no-op and caches.default carries the load alone.
// ---------------------------------------------------------------------------

function kvAvailable() {
  try {
    return typeof KV !== 'undefined' && KV &&
      typeof KV.get === 'function' && typeof KV.put === 'function'
  } catch {
    return false
  }
}

async function kvGet(key) {
  if (!kvAvailable()) return null
  try {
    return await KV.get(key)
  } catch {
    return null
  }
}

function kvPut(ctx, key, value, ttl) {
  if (!kvAvailable()) return
  try {
    ctx.waitUntil(KV.put(key, value, { expirationTtl: ttl }).catch(() => {}))
  } catch {
    // Cache is an optimisation. Never let a failed put break the request.
  }
}

// ---------------------------------------------------------------------------
// Allowlist — the security control
// ---------------------------------------------------------------------------

function parseAllowList(raw) {
  if (!raw) return []
  // Accepts comma OR newline separated, so one host per line works in a text
  // file without anyone having to remember the comma rule. Comments (#) and
  // blank lines are stripped so the file can be self-documenting.
  // Comments are cut from the "#" to end-of-line BEFORE splitting, or every
  // word after a "#" becomes a bogus hostname.
  return String(raw)
    .replace(/#.*$/gm, '')
    .split(/[\s,]+/)
    .map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0])
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Allowlist source — KV, changed only when you change it
//
// The list lives in Workers KV under ALLOWLIST_KV_KEY, written via
// POST /admin/hosts. No timer, no polling: every request reads the live
// value, so an edit takes effect on the next request. Source hosts never
// touch git — they are runtime state, not code.
//
// Fallback chain: KV list → ALLOWED_HOSTS secret (bootstrap/recovery) → fail
// closed (empty list refuses everything).
// ---------------------------------------------------------------------------

const ALLOWLIST_KV_KEY = 'ALLOWLIST_V1'
const MAX_HOSTS_BODY_BYTES = 10 * 1024

async function loadAllowList(env) {
  const raw = await kvGet(ALLOWLIST_KV_KEY)
  if (raw) {
    try {
      const stored = JSON.parse(raw)
      const list = parseAllowList(Array.isArray(stored) ? stored.join(',') : stored.hosts || '')
      if (list.length) return { list, source: 'kv' }
    } catch { /* corrupt entry — fall through to secret */ }
  }
  return { list: parseAllowList(env && env.ALLOWED_HOSTS), source: 'secret' }
}

// Constant-time compare so tokens cannot be guessed byte-by-byte.
function adminTokenMatches(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false
  if (!expected || candidate.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

function adminAuthed(request, env) {
  const expected = env && env.ADMIN_TOKEN
  if (!expected) return false // no token configured — admin stays closed
  const header = request.headers.get('x-admin-token')
  if (header && adminTokenMatches(header, expected)) return true
  const auth = request.headers.get('authorization')
  const bearer = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null
  return !!bearer && adminTokenMatches(bearer, expected)
}

function adminResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8', ...CORS_HEADERS },
  })
}

async function handleAdminHosts(request, env) {
  if (!adminAuthed(request, env)) {
    return adminResponse({ error: 'Unauthorized' }, 401)
  }
  if (request.method === 'GET') {
    const { list, source } = await loadAllowList(env)
    return adminResponse({ hosts: list, count: list.length, source })
  }
  if (request.method === 'POST' || request.method === 'PUT') {
    if (!kvAvailable()) {
      return adminResponse({ error: 'KV not bound — cannot persist hosts' }, 500)
    }
    const body = await request.text()
    if (body.length > MAX_HOSTS_BODY_BYTES) {
      return adminResponse({ error: 'Hosts body too large (max 10KB)' }, 413)
    }
    const list = parseAllowList(body)
    if (!list.length) {
      return adminResponse({ error: 'No valid hosts parsed — list unchanged' }, 400)
    }
    // Awaited, not waitUntil: the response confirms the write landed.
    try {
      await KV.put(ALLOWLIST_KV_KEY, JSON.stringify(list))
    } catch {
      return adminResponse({ error: 'KV write failed — list unchanged' }, 500)
    }
    return adminResponse({ ok: true, count: list.length, hosts: list })
  }
  return adminResponse({ error: 'Method not allowed (GET, POST, PUT)' }, 405)
}

function hostAllowed(hostname, allowList) {
  const h = String(hostname || '').toLowerCase()
  if (!h) return false
  for (const entry of allowList) {
    if (entry.startsWith('.')) {
      if (h.endsWith(entry)) return true            // subdomains only
    } else if (h === entry || h.endsWith('.' + entry)) {
      return true                                    // exact + subdomains
    }
  }
  return false
}

// Belt-and-braces: even if someone allowlists something broad, never let the
// Worker reach loopback / LAN. This matters because a Cloudflare Tunnel to the
// user's own Bun server would otherwise be reachable as an SSRF target.
function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase()
  return (
    h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
    h.endsWith('.internal') || h.endsWith('.home.arpa') ||
    /^127\./.test(h) || /^0\./.test(h) || /^10\./.test(h) ||
    /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(h) ||
    h === '::1' || h === '[::1]' || /^f[cd][0-9a-f]{2}:/.test(h) ||
    /^fe80:/.test(h)
  )
}

// ---------------------------------------------------------------------------
// Routing helpers
// ---------------------------------------------------------------------------

// Derives a short, stable per-source path id (used by /p/{id}).
function extractSourceId(apiUrl, fallback = 'source') {
  try {
    const url = new URL(apiUrl)
    const parts = url.hostname.split('.')
    if (
      parts.length >= 3 &&
      ['caiji', 'api', 'cj', 'www'].includes(parts[0])
    ) {
      return parts[parts.length - 2].toLowerCase().replace(/[^a-z0-9]/g, '') || fallback
    }
    let name = parts[0].toLowerCase()
    name = name.replace(/zyapi$/, '').replace(/zy$/, '').replace(/api$/)
    return name.replace(/[^a-z0-9]/g, '') || fallback
  } catch {
    return fallback
  }
}

function base58Encode(obj) {
  const str = JSON.stringify(obj)
  const bytes = new TextEncoder().encode(str)
  let intVal = 0n
  for (const b of bytes) intVal = (intVal << 8n) + BigInt(b)
  let result = ''
  while (intVal > 0n) {
    result = BASE58_ALPHABET[Number(intVal % 58n)] + result
    intVal = intVal / 58n
  }
  for (const b of bytes) {
    if (b === 0) result = BASE58_ALPHABET[0] + result
    else break
  }
  return result
}

// Rewrites every `api` field in a LunaTV config to point at this Worker.
function addOrReplacePrefix(obj, newPrefix) {
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map(item => addOrReplacePrefix(item, newPrefix))
  const out = {}
  for (const key in obj) {
    if (key === 'api' && typeof obj[key] === 'string') {
      let apiUrl = obj[key]
      const urlIndex = apiUrl.indexOf('?url=')
      if (urlIndex !== -1) apiUrl = apiUrl.slice(urlIndex + 5)
      if (!apiUrl.startsWith(newPrefix)) {
        const sourceId = extractSourceId(apiUrl)
        const baseUrl = newPrefix.replace(/\/?\?url=$/, '')
        apiUrl = `${baseUrl}/p/${sourceId}?url=${encodeURIComponent(apiUrl)}`
      }
      out[key] = apiUrl
    } else {
      out[key] = addOrReplacePrefix(obj[key], newPrefix)
    }
  }
  return out
}

// cacheKey() above is the single source of truth for cache keys. Match AND put
// must both use it — the old code matched on request.headers but stored on
// upstreamHeaders, so the cache never once hit.

function isSegmentUrl(pathname) {
  return /\.(ts|m4s|mp4|aac|m4a|webm)(\?|$)/i.test(pathname)
}

function isManifestUrl(pathname) {
  return /\.(m3u8|m3u)(\?|$)/i.test(pathname)
}

function applyDefaultHeadersForUpstream(headers, targetURL) {
  const host = targetURL.hostname.toLowerCase()

  // Bangumi rejects standard browser UA with 400; requires "App/Version (URL)".
  if (host === 'lain.bgm.tv' || host.endsWith('.bgm.tv')) {
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', 'LunaTV-Mobile/1.0 (https://github.com/djsevenx1/LunaTV-Mobile)')
    }
    if (!headers.has('Referer')) headers.set('Referer', 'https://bgm.tv/')
    if (!headers.has('Accept')) {
      headers.set('Accept', 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8')
    }
  }

  // Many video CDNs return 403 for m3u8/.ts without a matching Referer.
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent',
      'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36')
  }
  if (!headers.has('Referer')) headers.set('Referer', targetURL.origin + '/')
  if (!headers.has('Origin')) headers.set('Origin', targetURL.origin)
  if (!headers.has('Accept')) headers.set('Accept', '*/*')
}

function errorResponse(error, data = {}, status = 400) {
  return new Response(JSON.stringify({ error, ...data }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  })
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

async function handleRequest(request, env, ctx) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const reqUrl = new URL(request.url)
  const pathname = reqUrl.pathname
  const currentOrigin = reqUrl.origin

  // Admin first: it needs no allowlist, only the admin token.
  if (pathname === '/admin/hosts') {
    return handleAdminHosts(request, env)
  }

  const { list: allowList, source: allowSource } = await loadAllowList(env)

  // Health is public so the Bun gate can probe without a token.
  if (pathname === '/health') {
    return new Response('OK', {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'X-Allowed-Hosts': String(allowList.length),
        'X-Allowlist-Source': allowSource,
      },
    })
  }

  if (pathname === '/speed') {
    return handleSpeedTest(reqUrl)
  }

  const targetUrlParam = extractTargetUrl(request, reqUrl)
  if (targetUrlParam) {
    // /p/{sourceId}?url= — per-source path so TVBox treats sources as
    // distinct origins and cache entries never collide.
    if (pathname.startsWith('/p/')) {
      return handleProxyRequest(request, ctx, targetUrlParam, reqUrl, currentOrigin, allowList)
    }
    if (pathname === '/m3u8' || isManifestUrl(pathname)) {
      return handleM3u8Request(request, ctx, targetUrlParam, reqUrl, currentOrigin, allowList)
    }
    return handleProxyRequest(request, ctx, targetUrlParam, reqUrl, currentOrigin, allowList)
  }

  if (reqUrl.searchParams.get('format') !== null) {
    return handleFormatRequest(ctx, reqUrl, currentOrigin)
  }

  return handleHomePage(currentOrigin, allowList.length)
}

// The target URL is url=... and may itself contain unencoded "&" params.
// Prefer the raw capture so we never split the target's own query string.
function extractTargetUrl(request, reqUrl) {
  const m = request.url.match(/[?&]url=([^&]+)/)
  if (m) {
    try { return decodeURIComponent(m[1]) } catch { return m[1] }
  }
  return reqUrl.searchParams.get('url')
}

// ---------------------------------------------------------------------------
// Generic proxy: method + body + headers passthrough, edge-cached segments
// ---------------------------------------------------------------------------

async function handleProxyRequest(request, ctx, targetUrl, reqUrl, currentOrigin, allowList) {
  let targetURL
  try {
    targetURL = new URL(targetUrl)
  } catch {
    return errorResponse('Invalid target URL', { url: targetUrl })
  }

  if (targetURL.protocol !== 'http:' && targetURL.protocol !== 'https:') {
    return errorResponse('Unsupported protocol', { protocol: targetURL.protocol })
  }

  if (targetURL.origin === currentOrigin) {
    return errorResponse('Loop detected: self-fetch blocked', { url: targetUrl })
  }

  if (isPrivateHost(targetURL.hostname)) {
    return errorResponse('Blocked host', { host: targetURL.hostname }, 403)
  }

  if (!hostAllowed(targetURL.hostname, allowList)) {
    return errorResponse('Host not in ALLOWED_HOSTS', {
      host: targetURL.hostname,
      hint: 'Add this host to the Worker secret ALLOWED_HOSTS.',
    }, 403)
  }

  // Forward any control/query params the client added, without duplicating
  // ones already present on the target.
  const control = new Set(['url', 'format', 'prefix', 'source', 'nocache'])
  for (const [key, value] of reqUrl.searchParams) {
    if (control.has(key)) continue
    if (!targetURL.searchParams.has(key)) targetURL.searchParams.append(key, value)
  }

  const upstreamHeaders = new Headers(request.headers)
  applyDefaultHeadersForUpstream(upstreamHeaders, targetURL)

  const isSegment = isSegmentUrl(targetURL.pathname)
  const cacheable = request.method === 'GET' && isSegment

  if (cacheable) {
    const hit = await cacheMatch(cacheKey(targetURL.toString()))
    if (hit) {
      const h = new Headers(hit.headers)
      h.set('X-Cache', 'HIT')
      for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v)
      // Pass the body stream through — do NOT arrayBuffer() it.
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: h })
    }
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_SEGMENT)

  try {
    const response = await fetch(targetURL.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      body: hasBody ? await request.arrayBuffer() : undefined,
      signal: controller.signal,
      cf: isSegment ? { cacheTtl: TTL_SEGMENT, cacheEverything: true } : undefined,
    })
    clearTimeout(timeoutId)

    const headers = new Headers()
    for (const [key, value] of response.headers) {
      if (!EXCLUDE_HEADERS.has(key.toLowerCase())) headers.set(key, value)
    }
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)

    if (response.ok) {
      // Upstream CDNs (Bunny.net et al.) serve 40-day-stale entries; force
      // revalidation so we never hand a month-old image or playlist to a player.
      // Segments are the exception — they are immutable and want to be cached.
      headers.set('Cache-Control', isSegment ? `public, max-age=${TTL_SEGMENT}` : 'no-store, no-cache, must-revalidate')
      if (isSegment) headers.set('CDN-Cache-Control', `public, max-age=${TTL_SEGMENT}`)
      else headers.set('Pragma', 'no-cache')
    }
    // Always label the cache state, so a MISS is distinguishable from a
    // response that never had caching in play.
    headers.set('X-Cache', cacheable ? 'MISS' : 'BYPASS')

    // Store the upstream copy BEFORE we overwrite Cache-Control to no-store,
    // otherwise caches.default refuses it. clone() is required because the
    // body has already been consumed by the client-facing Response.
    if (cacheable && response.ok) {
      const headers2 = new Headers(headers)
      headers2.set('Cache-Control', `public, max-age=${TTL_SEGMENT}`)
      cacheStore(ctx, cacheKey(targetURL.toString()), new Response(response.clone().body, {
        status: response.status, statusText: response.statusText, headers: headers2,
      }), TTL_SEGMENT)
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (err) {
    clearTimeout(timeoutId)
    return errorResponse('Proxy Error', { message: err.message, target: targetUrl }, 502)
  }
}

// ---------------------------------------------------------------------------
// m3u8: fetch manifest, rewrite every URI back through this Worker
// ---------------------------------------------------------------------------

async function handleM3u8Request(request, ctx, targetUrl, reqUrl, currentOrigin, allowList) {
  let targetURL
  try {
    targetURL = new URL(targetUrl)
  } catch {
    return errorResponse('Invalid target URL', { url: targetUrl })
  }

  if (targetURL.origin === currentOrigin) {
    return errorResponse('Loop detected: self-fetch blocked', { url: targetUrl })
  }
  if (isPrivateHost(targetURL.hostname)) {
    return errorResponse('Blocked host', { host: targetURL.hostname }, 403)
  }
  if (!hostAllowed(targetURL.hostname, allowList)) {
    return errorResponse('Host not in ALLOWED_HOSTS', { host: targetURL.hostname }, 403)
  }

  const control = new Set(['url', 'format', 'prefix', 'source', 'nocache'])
  for (const [key, value] of reqUrl.searchParams) {
    if (control.has(key)) continue
    if (!targetURL.searchParams.has(key)) targetURL.searchParams.append(key, value)
  }

  // Key includes our own origin so a domain swap never serves stale links.
  // The KV string key keeps the pre-rewrite format so older entries hit.
  const m3u8CacheKey = namespacedKey('m3u8', `${currentOrigin}|${targetURL.toString()}`)
  const m3u8KvKey = `M3U8_${currentOrigin}_${targetURL.toString()}`
  const nocache = reqUrl.searchParams.get('nocache') === '1'

  if (!nocache) {
    const kvText = await kvGet(m3u8KvKey)
    if (kvText) return m3u8Response(kvText, 'HIT')
    const hit = await cacheMatch(m3u8CacheKey)
    if (hit) {
      const body = await hit.text()
      const h = new Headers(hit.headers)
      h.set('X-Cache', 'HIT')
      for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v)
      return new Response(body, { status: hit.status, headers: h })
    }
  }

  // Base for resolving relative URIs. Starts as the requested URL but is
  // replaced by the POST-REDIRECT final URL below — several sources 302 to the
  // real playlist, and resolving relatives against the pre-redirect URL
  // silently produces 404 segments.
  let baseURL = targetURL

  // Manifests keep rewriting themselves to /m3u8?url= so that sub-playlists
  // are rewritten too. A raw pass-through leaves .ts links untouched, which
  // breaks relative-path resolution and hides duration from libmpv.
  const wrapBase = (rawUrl) => {
    const u = String(rawUrl || '').toLowerCase()
    if (isManifestUrl(u.split('?')[0])) return `${currentOrigin}/m3u8?url=`
    return `${currentOrigin}/?url=`
  }

  const wrapSegment = (rawLine) => {
    const line = rawLine.trim()
    if (!line) return line
    if (line.startsWith('#')) return line
    if (/^https?:\/\//i.test(line)) return wrapBase(line) + encodeURIComponent(line)
    if (line.startsWith('//')) {
      const abs = baseURL.protocol + line
      return wrapBase(abs) + encodeURIComponent(abs)
    }
    try {
      const abs = new URL(line, baseURL).toString()
      return wrapBase(abs) + encodeURIComponent(abs)
    } catch {
      return line
    }
  }

  let text
  let upstreamStatus = 200

  try {
    const headers = new Headers()
    applyDefaultHeadersForUpstream(headers, targetURL)
    headers.set('Accept', '*/*')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MANIFEST)
    const upstream = await fetch(targetURL.toString(), {
      headers,
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timeoutId)

    upstreamStatus = upstream.status
    text = await upstream.text()

    // Resolve relatives against wherever we ACTUALLY ended up after redirects.
    let finalURL
    try { finalURL = new URL(upstream.url || targetURL.toString()) } catch { finalURL = targetURL }

    // A redirect can land somewhere the allowlist would never have permitted.
    if (finalURL.origin !== currentOrigin &&
        (isPrivateHost(finalURL.hostname) || !hostAllowed(finalURL.hostname, allowList))) {
      return errorResponse('Redirect target not allowed', { host: finalURL.hostname }, 403)
    }
    baseURL = finalURL

    // Reject HTML only. Some sources hand back a /share/ page instead of the
    // playlist, and libmpv dies with "Failed to recognize file format". Anything
    // else — leading whitespace, BOM, comments — is still a playlist worth
    // rewriting, so a strict #EXTM3U check would throw away working streams.
    const contentType = (upstream.headers.get('content-type') || '').toLowerCase()
    const looksHtml = contentType.includes('text/html') ||
                      /^\s*(<!doctype\s+html|<html|<\?xml)/i.test(text)

    if (looksHtml) {
      return new Response(text, {
        status: upstreamStatus,
        headers: {
          'Content-Type': contentType || 'text/html; charset=utf-8',
          'X-Corsapi': 'REJECTED-HTML',
          ...CORS_HEADERS,
        },
      })
    }
  } catch (err) {
    return errorResponse('M3U8 Fetch Error', { message: err.message, target: targetUrl }, 502)
  }

  const isMaster = /#EXT-X-STREAM-INF/i.test(text)
  const lines = text.split(/\r?\n/)
  const out = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // URI="..." attributes: encryption keys, init segments, alternate renditions
    if (/^#EXT-X-(KEY|MAP|MEDIA|I-FRAME-STREAM-INF)/i.test(line)) {
      out.push(line.replace(/URI="([^"]+)"/g, (m, u) => {
        let abs
        try { abs = new URL(u, targetURL).toString() } catch { abs = u }
        return `URI="${wrapBase(abs) + encodeURIComponent(abs)}"`
      }))
      continue
    }

    // The variant URI is the line AFTER #EXT-X-STREAM-INF, not the tag itself.
    if (isMaster && /^#EXT-X-STREAM-INF/i.test(line)) {
      out.push(line)
      if (i + 1 < lines.length) {
        out.push(wrapSegment(lines[i + 1]))
        i++
      }
      continue
    }

    out.push(wrapSegment(line))
  }

  const outText = out.join('\n')
  const response = m3u8Response(outText, nocache ? 'BYPASS' : 'MISS', upstreamStatus)

  if (!nocache) {
    kvPut(ctx, m3u8KvKey, outText, TTL_M3U8)
    cacheStore(ctx, m3u8CacheKey, response.clone(), TTL_M3U8)
  }

  return response
}

function m3u8Response(text, cacheState, status = 200) {
  return new Response(text, {
    status,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'public, max-age=60',
      'X-Cache': cacheState,
      'Alt-Svc': 'h3=":443"; ma=86400',
      ...CORS_HEADERS,
    },
  })
}

// ---------------------------------------------------------------------------
// LunaTV config output
// ---------------------------------------------------------------------------

async function handleFormatRequest(ctx, reqUrl, currentOrigin) {
  const formatParam = reqUrl.searchParams.get('format')
  const config = FORMAT_CONFIG[formatParam]
  if (!config) return errorResponse('Invalid format parameter', { format: formatParam })

  const sourceParam = reqUrl.searchParams.get('source')
  const selectedSource = JSON_SOURCES[sourceParam] || JSON_SOURCES['full']
  const defaultPrefix = currentOrigin + '/?url='
  const prefix = reqUrl.searchParams.get('prefix') || defaultPrefix

  const jsonCacheKey = namespacedKey('json', selectedSource)
  const jsonKvKey = 'CACHE_' + selectedSource

  try {
    let data = null

    const kvJson = await kvGet(jsonKvKey)
    if (kvJson) {
      try { data = JSON.parse(kvJson) } catch { /* corrupt entry, refetch */ }
    }

    if (!data) {
      const hit = await cacheMatch(jsonCacheKey)
      if (hit) {
        try { data = await hit.json() } catch { /* corrupt entry, refetch */ }
      }
    }

    if (!data) {
      const res = await fetch(selectedSource)
      if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`)
      data = await res.json()
      kvPut(ctx, jsonKvKey, JSON.stringify(data), TTL_JSON)
      cacheStore(ctx, jsonCacheKey, new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      }), TTL_JSON)
    }

    const result = config.proxy ? addOrReplacePrefix(data, prefix) : data

    if (config.base58) {
      return new Response(base58Encode(result), {
        headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...CORS_HEADERS },
      })
    }
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json;charset=UTF-8', ...CORS_HEADERS },
    })
  } catch (err) {
    return errorResponse(err.message, { source: selectedSource }, 500)
  }
}

// ---------------------------------------------------------------------------
// Speed test — capped, one-shot Uint8Array (streams get cut by CF backpressure)
// ---------------------------------------------------------------------------

async function handleSpeedTest(reqUrl) {
  const requested = parseInt(reqUrl.searchParams.get('size') || '1', 10)
  const sizeMB = Math.max(1, Math.min(MAX_SPEED_TEST_MB, Number.isNaN(requested) ? 1 : requested))
  const totalBytes = sizeMB * 1024 * 1024
  // Zero-fill only: crypto.getRandomValues adds memory pressure on some nodes,
  // and a bandwidth test does not need cryptographic randomness.
  const buffer = new Uint8Array(totalBytes)

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': totalBytes.toString(),
      'Content-Disposition': `attachment; filename="speedtest-${sizeMB}mb.bin"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      ...CORS_HEADERS,
    },
  })
}

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------

async function handleHomePage(currentOrigin, allowCount) {
  const configured = allowCount > 0
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CORSAPI</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--g:#22C55E;--gd:#10B981;--bg:#0F1117;--c:#1F2937;--bd:#374151;--s:#9ca3af}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:#fff;line-height:1.6;padding:24px 16px}
  .w{max-width:820px;margin:0 auto}
  .top{display:flex;align-items:center;gap:8px;margin-bottom:20px}
  .logo{width:28px;height:28px;border-radius:6px;background:linear-gradient(135deg,var(--g),var(--gd));display:flex;align-items:center;justify-content:center;font-weight:800;color:#052e16}
  .brand{font-size:16px;font-weight:700}
  .pill{margin-left:auto;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;background:rgba(34,197,94,.12);color:var(--g)}
  .warn{background:rgba(239,68,68,.12);border:1px solid #7f1d1d;color:#fca5a5;padding:14px 16px;border-radius:8px;margin-bottom:16px;font-size:14px}
  .box{background:var(--c);border:1px solid var(--bd);border-radius:12px;padding:18px 22px;margin-bottom:14px}
  h1{font-size:24px;font-weight:800;margin-bottom:6px}
  h2{font-size:15px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:10px}
  h2::before{content:"";width:3px;height:14px;background:linear-gradient(180deg,var(--g),var(--gd));border-radius:2px}
  p{color:var(--s);font-size:14px}
  code{background:rgba(34,197,94,.12);color:var(--g);padding:2px 6px;border-radius:4px;font-family:Consolas,monospace;font-size:13px}
  pre{background:#0b0e14;border:1px solid var(--bd);border-radius:8px;padding:14px 16px;margin:10px 0;overflow-x:auto;font-family:Consolas,monospace;font-size:12.5px;color:#d1d5db}
  ul{list-style:none;margin:8px 0}
  li{color:var(--s);font-size:14px;padding:5px 0;display:flex;gap:8px;align-items:center}
  li::before{content:"";width:5px;height:5px;background:var(--g);border-radius:50%;flex-shrink:0}
</style>
</head>
<body><div class="w">
  <div class="top">
    <div class="logo">C</div><span class="brand">CORSAPI</span>
    <span class="pill">running</span>
  </div>

  ${configured ? '' : `<div class="warn"><b>ALLOWED_HOSTS is not set.</b><br>Every request is refused right now — this Worker fails closed on purpose. Set the <code>ALLOWED_HOSTS</code> secret to enable it.</div>`}

  <div class="box">
    <h1>API relay proxy</h1>
    <p>Edge proxy for cross-origin APIs and HLS streams. Runs on Cloudflare Workers.</p>
  </div>

  <div class="box">
    <h2>Endpoints</h2>
    <ul>
      <li><code>GET /?url=&lt;encoded&gt;</code> generic relay — method, headers and body passthrough</li>
      <li><code>GET /m3u8?url=&lt;encoded&gt;</code> HLS proxy — rewrites every segment URI</li>
      <li><code>GET /p/{source}?url=&lt;encoded&gt;</code> per-source path, prevents cache collisions</li>
      <li><code>GET /?format=1&amp;source=full</code> LunaTV config output (proxy mode)</li>
      <li><code>GET /health</code> health check</li>
      <li><code>GET /speed?size=1</code> bandwidth probe (max ${MAX_SPEED_TEST_MB}MB)</li>
      <li><code>GET|POST /admin/hosts</code> allowlist (needs <code>x-admin-token</code>)</li>
    </ul>
  </div>

  <div class="box">
    <h2>Usage</h2>
    <pre>direct:  https://api.example.com/data?id=123
relay:   ${currentOrigin}/?url=https://api.example.com/data?id=123

HLS:     ${currentOrigin}/m3u8?url=https://cdn.example.com/index.m3u8

config:  ${currentOrigin}/?format=3&amp;source=full</pre>
  </div>

  <div class="box">
    <h2>Design</h2>
    <p>Video segments are served straight from this Worker. Bun server.js acts only as an auth gate in front of it — it holds no proxy logic, so there is nothing to keep in sync between the two.</p>
  </div>
</div></body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
  })
}

// Named export so the Netlify edge-function build can import the same engine.
export { handleRequest }
