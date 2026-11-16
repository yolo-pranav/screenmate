// tmdblive — TMDB proxy for API and image requests: keeps the TMDB API key
// server-side, adds CORS headers for the app and caches responses at the edge.
//
// Secrets (Cloudflare → Workers → tmdblive → Settings → Variables and Secrets):
//   TMDB_API_KEY  (secret) — added to every API request; clients never need it.
//
// Usage: GET /?url=<TMDB URL>, ideally encodeURIComponent'd. Only
// api.themoviedb.org/3/* and image.tmdb.org/t/p/* targets are allowed.

const ALLOWED = new Map([
  ['api.themoviedb.org', '/3/'],
  ['image.tmdb.org', '/t/p/'],
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const HOUR = 3600;
const DAY = 24 * HOUR;

// Edge + client cache lifetime (seconds) per upstream resource
const cacheTtl = (target) => {
  if (target.hostname === 'image.tmdb.org') return 30 * DAY; // image paths never change content
  if (/^\/3\/(genre|configuration)\//.test(target.pathname)) return 7 * DAY;
  if (/^\/3\/(trending|search)\//.test(target.pathname)) return HOUR;
  return 6 * HOUR; // details, seasons, recommendations
};

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
});

// Existing app builds append the target unencoded (`?url=https://…?query=x&page=2`),
// which URLSearchParams would cut at the first `&` (dropping `page`). Take
// everything after `url=` verbatim instead; encoded targets are decoded once.
const readTarget = (requestUrl) => {
  const query = new URL(requestUrl).search.slice(1);
  if (!query.startsWith('url=')) return null;
  const raw = query.slice('url='.length);
  try {
    return new URL(/^https?%3A/i.test(raw) ? decodeURIComponent(raw) : raw);
  } catch {
    return null;
  }
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Method not allowed' });
    if (!env.TMDB_API_KEY) return json(500, { error: 'TMDB_API_KEY is not configured' });

    const target = readTarget(request.url);
    if (!target) return json(400, { error: "Missing or invalid 'url' parameter" });

    const allowedPath = ALLOWED.get(target.hostname);
    if (target.protocol !== 'https:' || !allowedPath || !target.pathname.startsWith(allowedPath)) {
      return json(403, { error: 'Forbidden' });
    }

    // Always use the server-side key — replaces any key an older client sent
    if (target.hostname === 'api.themoviedb.org') {
      target.searchParams.set('api_key', env.TMDB_API_KEY);
    } else {
      target.searchParams.delete('api_key');
    }

    const ttl = cacheTtl(target);
    let upstream;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers: { Accept: request.headers.get('Accept') ?? '*/*' },
        cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, '404': 300, '500-599': 0 } },
      });
    } catch {
      return json(502, { error: 'Upstream request failed' });
    }

    const headers = new Headers(CORS_HEADERS);
    headers.set('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json');
    if (upstream.ok) headers.set('Cache-Control', `public, max-age=${ttl}`);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
