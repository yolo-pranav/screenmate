// screenmate — remote config for the app, so keys and endpoints can change
// without shipping a new build.
//
// Each account's config worker is `profiles.worker_url` in Supabase (signed-out
// users use this one). Every deployment runs this same code; what it serves is
// decided by its variables.
//
// Everything returned here reaches the client app, whatever ACCESS is set to
// (with ACCESS=public anyone can read it; with ACCESS=profile every entitled
// signed-in user can). Only set client-safe values. Never add the Supabase
// service_role key or the TMDB API key (that one lives in the tmdblive worker).
//
// Variables (Cloudflare → Workers → <name> → Settings → Variables and Secrets):
//   SUPABASE_URL       https://<project>.supabase.co
//   SUPABASE_ANON_KEY  Supabase anon/public key (data access is enforced by RLS)
//   TMDB_PROXY_URL     https://tmdblive.<account>.workers.dev/?url=
//   PLAYER_MODE        trailer | embed | none — what the player page shows:
//                      the title's trailer, the platform's own player,
//                      or nothing
//   EMBED_MOVIE_URL    (embed mode only) your player page for a movie, with {imdb_id},
//                      e.g. https://player.example.com/movie/{imdb_id}
//   EMBED_TV_URL       (embed mode only) your player page for an episode, with
//                      {imdb_id} {season} {episode},
//                      e.g. https://player.example.com/tv/{imdb_id}/{season}/{episode}
//   ACCESS             public (default) | profile — with `profile` the config is
//                      only served to signed-in users whose profiles.worker_url
//                      points at this worker. The default worker (the app's
//                      CONFIG_URL) must stay public; other deployments need the
//                      same SUPABASE_URL and SUPABASE_ANON_KEY.
//   UPDATE_REPO        (optional) owner/repo of the public GitHub repository whose
//                      latest release carries android-update.json, e.g.
//                      yolo-pranav/screenmate. Unset: /update/android reports
//                      no update. Only the default worker needs it.
//
// Usage: GET /config   (ACCESS=profile: with `Authorization: Bearer <user JWT>`)
//        GET /update/android   latest Android release ({} when there is none);
//                              always public and independent of the variables
//                              above, so a broken config can still be fixed by
//                              an update
//        GET /trailer?v=<YouTube video id>   a page that only embeds that
//                              video. The Android and iOS apps load trailers
//                              through it: their WebViews run on
//                              http://localhost / capacitor://localhost and send
//                              YouTube no usable Referer, so a direct embed
//                              fails with "Error 153". Served from here, the
//                              embed gets this worker's origin as its Referer.
//                              Always public and independent of the variables
//                              above. It may be framed by any site (no
//                              frame-ancestors / X-Frame-Options, since a source
//                              list cannot match the app's localhost origins).

const PLAYER_MODES = ['trailer', 'embed', 'none'];
const ACCESS_MODES = ['public', 'profile'];

const TEMPLATE_PLACEHOLDERS = {
  EMBED_MOVIE_URL: ['{imdb_id}'],
  EMBED_TV_URL: ['{imdb_id}', '{season}', '{episode}'],
};

// Short so a changed variable reaches clients within minutes
const CACHE_SECONDS = 300;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (status, body, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
});

const playerMode = (env) => env.PLAYER_MODE || 'trailer';
const accessMode = (env) => env.ACCESS || 'public';

// Payload of a JWT-format Supabase key ({ ref, role, ... }), or null
const jwtPayload = (key) => {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
};

// What's wrong with SUPABASE_ANON_KEY, without revealing it. Legacy anon keys
// are JWTs naming their project (`ref`) and `role`; newer keys are
// sb_publishable_… (client-safe) or sb_secret_… (server-only).
const anonKeyProblem = (key, supabaseUrl) => {
  if (key.startsWith('sb_publishable_')) return null;
  if (key.startsWith('sb_secret_')) return 'SUPABASE_ANON_KEY is a secret key: use the anon or publishable key';
  const payload = jwtPayload(key);
  if (!payload) return 'SUPABASE_ANON_KEY is not a Supabase anon or publishable key';
  if (payload.role && payload.role !== 'anon') return `SUPABASE_ANON_KEY is a ${payload.role} key: use the anon key`;
  let host = '';
  try { host = new URL(supabaseUrl).hostname; } catch {}
  // Only checkable on the default <ref>.supabase.co domain
  if (payload.ref && host.endsWith('.supabase.co') && host !== `${payload.ref}.supabase.co`) {
    return 'SUPABASE_ANON_KEY belongs to a different project than SUPABASE_URL';
  }
  return null;
};

// Names (never values) of variables that are missing or malformed
const findProblems = (env) => {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'TMDB_PROXY_URL'];
  const mode = playerMode(env);
  if (mode === 'embed') required.push('EMBED_MOVIE_URL', 'EMBED_TV_URL');
  const problems = required.filter(name => !env[name]).map(name => `${name} is not set`);
  if (!PLAYER_MODES.includes(mode)) problems.push(`PLAYER_MODE must be one of ${PLAYER_MODES.join(', ')}`);
  if (!ACCESS_MODES.includes(accessMode(env))) problems.push(`ACCESS must be one of ${ACCESS_MODES.join(', ')}`);
  for (const name of ['SUPABASE_URL', 'TMDB_PROXY_URL', 'EMBED_MOVIE_URL', 'EMBED_TV_URL']) {
    if (required.includes(name) && env[name] && !env[name].startsWith('https://')) problems.push(`${name} must start with https://`);
  }
  if (env.SUPABASE_ANON_KEY && env.SUPABASE_URL) {
    const keyProblem = anonKeyProblem(env.SUPABASE_ANON_KEY, env.SUPABASE_URL);
    if (keyProblem) problems.push(keyProblem);
  }
  // The app appends the encoded TMDB URL directly, so it must end with a url= param
  if (env.TMDB_PROXY_URL && !/[?&]url=$/.test(env.TMDB_PROXY_URL)) problems.push('TMDB_PROXY_URL must end with ?url=');
  if (mode === 'embed') {
    for (const [name, placeholders] of Object.entries(TEMPLATE_PLACEHOLDERS)) {
      if (!env[name]) continue;
      const missing = placeholders.filter(p => !env[name].includes(p));
      if (missing.length) problems.push(`${name} is missing ${missing.join(', ')}`);
    }
  }
  return problems;
};

// ACCESS=profile: the caller must be signed in, and their profile must point
// at this worker. The lookup runs with the caller's own token, so RLS returns
// only their row. Returns null when allowed, otherwise the error response.
const checkProfileAccess = async (request, env) => {
  const noStore = { 'Cache-Control': 'no-store' };
  const auth = request.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(auth)) return json(401, { error: 'Sign in required', reason: 'no token sent' }, noStore);
  let rows;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=worker_url&limit=1`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth },
    });
    if (res.status === 401 || res.status === 403) {
      // Supabase's own message tells a bad worker variable ("Invalid API key")
      // apart from a bad or expired user token ("JWT expired")
      const detail = await res.json().then(b => b?.message || b?.msg || null, () => null);
      return json(401, { error: 'Sign in required', reason: 'rejected by Supabase', detail }, noStore);
    }
    if (!res.ok) throw new Error(`profile lookup failed with ${res.status}`);
    rows = await res.json();
  } catch {
    return json(502, { error: 'Could not check access' }, noStore);
  }
  let workerOrigin = null;
  try { workerOrigin = new URL(rows?.[0]?.worker_url).origin; } catch {}
  if (workerOrigin !== new URL(request.url).origin) {
    return json(403, { error: 'Forbidden' }, noStore);
  }
  return null;
};

// Variables pasted into the dashboard often carry stray whitespace or
// surrounding quotes, and a Supabase URL a trailing slash; all would break
// requests built from them
const cleanEnv = (env) => {
  const clean = {};
  for (const [name, value] of Object.entries(env)) {
    clean[name] = typeof value === 'string' ? value.trim().replace(/^(['"])(.*)\1$/s, '$2').trim() : value;
  }
  if (clean.SUPABASE_URL) clean.SUPABASE_URL = clean.SUPABASE_URL.replace(/\/+$/, '');
  return clean;
};

const playerConfig = (env) => {
  const mode = playerMode(env);
  return mode === 'embed'
    ? { mode, embed: { movie: env.EMBED_MOVIE_URL, tv: env.EMBED_TV_URL } }
    : { mode };
};

// --- Android update manifest -------------------------------------------------
// Every GitHub release carries android-update.json; this relays the latest one.
// The releases/latest/download URL is a plain redirect to the asset, so unlike
// the GitHub API it is not rate limited.

const UPDATE_PATH = '/update/android';
const UPDATE_MANIFEST = 'android-update.json';
const UPDATE_CACHE_SECONDS = 600;
// A release published without the manifest (or none yet) is rechecked sooner
const UPDATE_MISSING_CACHE_SECONDS = 60;
const UPDATE_FETCH_TIMEOUT_MS = 10000;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// A plain https://github.com/<repo>/releases/download/... URL. URL parsing
// resolves dot segments (also %2e forms) and drops an empty "?" or "#" from
// search/hash, so those are rejected in the raw string.
const apkUrlIsValid = (apkUrl, repo) => {
  if (typeof apkUrl !== 'string' || /[?#]/.test(apkUrl) || /\/(\.|%2e){1,2}(\/|$)/i.test(apkUrl)) return false;
  let u;
  try { u = new URL(apkUrl); } catch { return false; }
  const prefix = `/${repo}/releases/download/`;
  return u.protocol === 'https:' && u.host === 'github.com' && !u.username && !u.password
    && !u.search && !u.hash && u.href === apkUrl
    && u.pathname.startsWith(prefix) && u.pathname.length > prefix.length;
};

// Why the manifest is unusable, or null when it is valid
const manifestProblem = (m, repo) => {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'not a JSON object';
  const parts = typeof m.version === 'string' && /^(\d+)\.(\d+)\.(\d+)$/.exec(m.version);
  if (!parts) return 'version is not x.y.z';
  const [major, minor, patch] = parts.slice(1).map(Number);
  // versionCode packs minor and patch into two digits each, as the client does
  if (minor > 99 || patch > 99) return 'version minor and patch must be at most 99';
  if (!Number.isInteger(m.versionCode)) return 'versionCode is not an integer';
  if (m.versionCode !== major * 10000 + minor * 100 + patch) return 'versionCode does not match version';
  if (!apkUrlIsValid(m.apkUrl, repo)) return `apkUrl is not under https://github.com/${repo}/releases/download/`;
  if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.sha256)) return 'sha256 is not 64 lowercase hex characters';
  return null;
};

// Cache API (absent outside Workers; a no-op on workers.dev)
const updateCache = () => (typeof caches !== 'undefined' && caches?.default) || null;

const fetchAndroidUpdate = async (repo) => {
  const url = `https://github.com/${repo}/releases/latest/download/${UPDATE_MANIFEST}`;
  const init = { redirect: 'follow', headers: { Accept: 'application/json', 'User-Agent': 'screenmate-worker' } };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(UPDATE_FETCH_TIMEOUT_MS);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    console.error('update manifest fetch failed', String(err));
    return json(502, { error: 'Could not reach GitHub' }, { 'Cache-Control': 'no-store' });
  }
  if (res.status === 404) {
    return json(200, {}, { 'Cache-Control': `public, max-age=${UPDATE_MISSING_CACHE_SECONDS}` });
  }
  if (!res.ok) {
    console.error('update manifest fetch failed', res.status);
    return json(502, { error: `GitHub answered ${res.status}` }, { 'Cache-Control': 'no-store' });
  }
  let manifest;
  try {
    manifest = JSON.parse(await res.text());
  } catch (err) {
    // A body cut off mid-read is a network failure; otherwise it is not JSON
    if (err instanceof SyntaxError) {
      console.error('update manifest is invalid: not JSON');
      return json(200, {}, { 'Cache-Control': 'no-store' });
    }
    console.error('update manifest read failed', String(err));
    return json(502, { error: 'Could not read the update manifest' }, { 'Cache-Control': 'no-store' });
  }
  const problem = manifestProblem(manifest, repo);
  if (problem) {
    console.error('update manifest is invalid:', problem);
    return json(200, {}, { 'Cache-Control': 'no-store' });
  }
  const { version, versionCode, apkUrl, sha256 } = manifest;
  return json(200, { version, versionCode, apkUrl, sha256 }, { 'Cache-Control': `public, max-age=${UPDATE_CACHE_SECONDS}` });
};

const handleAndroidUpdate = async (request, env, ctx) => {
  const repo = typeof env.UPDATE_REPO === 'string' ? env.UPDATE_REPO : '';
  let response;
  if (!repo) {
    response = json(200, {}, { 'Cache-Control': 'no-store' });
  } else if (!REPO_PATTERN.test(repo)) {
    console.error('UPDATE_REPO must look like owner/repo');
    response = json(200, {}, { 'Cache-Control': 'no-store' });
  } else {
    const cache = updateCache();
    // Keyed on this worker's own origin and the repo, always as a GET
    const cacheKey = new Request(`${new URL(request.url).origin}${UPDATE_PATH}?repo=${encodeURIComponent(repo)}`, { method: 'GET' });
    if (cache) {
      try { response = await cache.match(cacheKey); } catch { response = undefined; }
    }
    if (!response) {
      response = await fetchAndroidUpdate(repo);
      const cacheable = response.status === 200 && (response.headers.get('Cache-Control') || '').startsWith('public');
      if (cache && cacheable) {
        const put = cache.put(cacheKey, response.clone()).catch(() => {});
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(put); else await put;
      }
    }
  }
  if (request.method === 'HEAD') {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
};

// --- Trailer page ------------------------------------------------------------
// The page carries no script at all; its CSP allows only the YouTube embed
// frame and the inline styles below.

const TRAILER_PATH = '/trailer';
const TRAILER_CACHE_SECONDS = 86400;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const TRAILER_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': `public, max-age=${TRAILER_CACHE_SECONDS}`,
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'none'; frame-src https://www.youtube-nocookie.com; style-src 'unsafe-inline'",
  'X-Content-Type-Options': 'nosniff',
};

// Only called with an id that matched VIDEO_ID_PATTERN, so it needs no escaping
const trailerHtml = (id) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trailer</title>
<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}iframe{display:block;width:100%;height:100%;border:0}</style>
</head>
<body>
<iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1" title="Trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
</body>
</html>
`;

const handleTrailer = (request) => {
  const id = new URL(request.url).searchParams.get('v');
  const body = typeof id === 'string' && VIDEO_ID_PATTERN.test(id) ? trailerHtml(id) : null;
  if (body === null) {
    return new Response(request.method === 'HEAD' ? null : 'Invalid video id', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers: TRAILER_HEADERS });
};

export default {
  async fetch(request, rawEnv, ctx) {
    const env = cleanEnv(rawEnv);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Method not allowed' });

    const { pathname } = new URL(request.url);
    // Before the misconfiguration check: updates must keep working when the
    // config variables are broken
    if (pathname === UPDATE_PATH) return handleAndroidUpdate(request, env, ctx);
    if (pathname === TRAILER_PATH) return handleTrailer(request);
    if (pathname !== '/config') return json(404, { error: 'Not found' });

    const problems = findProblems(env);
    if (problems.length) return json(500, { error: 'Worker is misconfigured', problems });

    const restricted = accessMode(env) === 'profile';
    if (restricted) {
      const denied = await checkProfileAccess(request, env);
      if (denied) return denied;
    }

    return json(200, {
      supabase: { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY },
      tmdbProxyUrl: env.TMDB_PROXY_URL,
      player: playerConfig(env),
    }, {
      // A per-user answer must never be stored by a shared cache
      'Cache-Control': restricted ? 'private, no-store' : `public, max-age=${CACHE_SECONDS}`,
    });
  },
};
