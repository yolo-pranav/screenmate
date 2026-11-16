import { useSyncExternalStore } from 'react';
import { CONFIG_URL, DEFAULT_TMDB_PROXY_URL } from '@/constants';

// Remote config served by the `screenmate` worker (workers/screenmate), so keys
// and endpoints can change without shipping a new build. The last good copy is
// cached in localStorage and used immediately on the next launch; the built-in
// defaults cover the very first launch until the fetch succeeds. The defaults
// carry no Supabase keys, so sign-in/sync stays off until a remote config loads.

export interface EmbedTemplates { movie: string; tv: string }

// What the player page shows, as set by the config worker (see
// workers/screenmate and usePlayerConfig).
export type PlayerConfig =
  | { mode: 'trailer' }
  | { mode: 'none' }
  | { mode: 'embed'; embed: EmbedTemplates };

export interface AppConfig {
  supabase: { url: string; anonKey: string } | null;
  tmdbProxyUrl: string;
  player: PlayerConfig;
}

// Origin of the default worker, e.g. https://screenmate.<account>.workers.dev
export const DEFAULT_WORKER_ORIGIN = new URL(CONFIG_URL).origin;

// loading: no remote config yet, first fetch in flight
// ready:   a remote config is in use (cached or fresh)
// failed:  no remote config and the last fetch failed — retrying
export type ConfigStatus = 'loading' | 'ready' | 'failed';

interface Snapshot {
  config: AppConfig;
  status: ConfigStatus;
  // True once this launch's first fetch has settled (or the grace period ran
  // out). Auth waits for it so a cached, since-rotated Supabase key can't run
  // the startup token refresh, get a 401 and wipe the saved session.
  revalidated: boolean;
}

const STORAGE_KEY = 'remoteConfig';
const FETCH_TIMEOUT_MS = 10_000;
const RETRY_MS = 30_000;
const REVALIDATE_GRACE_MS = 5_000;
// Long-running sessions (Electron window, Android app resumed for days) re-check
// on return to foreground once the worker's 5 min cache could have changed, and
// on a slow interval otherwise.
const STALE_MS = 5 * 60_000;
const POLL_MS = 30 * 60_000;

const DEFAULT_CONFIG: AppConfig = {
  supabase: null,
  tmdbProxyUrl: DEFAULT_TMDB_PROXY_URL,
  player: { mode: 'trailer' },
};

const SERVER_SNAPSHOT: Snapshot = { config: DEFAULT_CONFIG, status: 'loading', revalidated: false };

let snapshot: Snapshot = SERVER_SNAPSHOT;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let inFlight: AbortController | null = null;
let lastSuccessAt = 0;
const listeners = new Set<() => void>();

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

// proxied() appends the encoded target, so the URL must end in a `url=` param
const isProxyUrl = (v: unknown): v is string =>
  isString(v) && v.startsWith('https://') && /[?&]url=$/.test(v);

export const parsePlayer = (raw: unknown): PlayerConfig | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (r.mode === 'trailer' || r.mode === 'none') return { mode: r.mode };
  if (r.mode !== 'embed') return null;
  const { movie, tv } = r.embed ?? {};
  if (!isString(movie) || !movie.startsWith('https://') || !movie.includes('{imdb_id}')) return null;
  if (!isString(tv) || !tv.startsWith('https://') ||
      !['{imdb_id}', '{season}', '{episode}'].every(p => tv.includes(p))) return null;
  return { mode: 'embed', embed: { movie, tv } };
};

// Rejects anything malformed so a bad deploy can't replace a working config.
// Configs cached by older builds (top-level `embed`, no `player`) use an
// outdated format and are rejected too, so a stale cache can't override the
// player mode the config worker currently sets for this account.
export const parseConfig = (raw: unknown): AppConfig | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (!isProxyUrl(r.tmdbProxyUrl)) return null;
  const player = parsePlayer(r.player);
  if (!player) return null;
  // Absent = sync intentionally off; present but broken = reject the whole
  // config, otherwise one typo in the worker would sign every device out
  let supabase: AppConfig['supabase'] = null;
  if (r.supabase != null) {
    const { url, anonKey } = r.supabase;
    if (!isString(url) || !url.startsWith('https://') || !isString(anonKey)) return null;
    supabase = { url, anonKey };
  }
  return { supabase, tmdbProxyUrl: r.tmdbProxyUrl, player };
};

const setSnapshot = (next: Snapshot) => {
  if (next.status === snapshot.status && next.revalidated === snapshot.revalidated &&
      JSON.stringify(next.config) === JSON.stringify(snapshot.config)) return;
  snapshot = next;
  listeners.forEach(l => l());
};

const markRevalidated = () => {
  if (!snapshot.revalidated) setSnapshot({ ...snapshot, revalidated: true });
};

const scheduleRetry = () => {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = undefined; refresh(); }, RETRY_MS);
};

// `restart` aborts a fetch already in flight (e.g. one that stalled before the
// network came back) instead of waiting out its timeout
const refresh = async ({ restart = false } = {}) => {
  if (inFlight) {
    if (!restart) return;
    inFlight.abort();
  }
  const controller = new AbortController();
  inFlight = controller;
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(CONFIG_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`Config request failed with ${res.status}`);
    const config = parseConfig(await res.json());
    if (!config) throw new Error('Config response is malformed');
    if (inFlight !== controller) return; // superseded by a restart
    lastSuccessAt = Date.now();
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch {}
    setSnapshot({ config, status: 'ready', revalidated: true });
  } catch (err) {
    if (inFlight !== controller) return; // aborted by a restart — the new fetch reports
    console.error('Failed to load remote config', err);
    // Keep using whatever we have (cached or defaults); only report the failure
    // when there's no remote config at all
    setSnapshot({
      ...snapshot,
      status: snapshot.status === 'loading' ? 'failed' : snapshot.status,
      revalidated: true,
    });
    scheduleRetry();
  } finally {
    clearTimeout(timeout);
    if (inFlight === controller) inFlight = null;
  }
};

// Runs once when the module first loads in the browser — before any render, so
// render-time reads (getConfig in imageUrl) never see the snapshot change mid-render.
if (typeof window !== 'undefined') {
  try {
    const cached = parseConfig(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null'));
    if (cached) snapshot = { config: cached, status: 'ready', revalidated: false };
  } catch {}
  refresh();
  // Don't hold auth hostage to a slow network — fall back to the cached copy
  setTimeout(markRevalidated, REVALIDATE_GRACE_MS);
  window.addEventListener('online', () => {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
    refresh({ restart: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastSuccessAt > STALE_MS) refresh();
  });
  setInterval(() => refresh(), POLL_MS);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

// For non-React code (data fetching). React components should use useConfig()
// so they re-render when a fresh config arrives.
export const getConfig = (): AppConfig => snapshot.config;

export const useConfig = (): Snapshot =>
  useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);

// Fills the embed-mode URL template (the platform's own player page) from the
// config, e.g. "https://player.example.com/tv/{imdb_id}/{season}/{episode}"
export const buildEmbedUrl = (
  embed: EmbedTemplates,
  mediaType: 'movie' | 'tv',
  imdbId: string,
  season: number,
  episode: number,
): string => {
  const values: Record<string, string> = {
    imdb_id: encodeURIComponent(imdbId),
    season: String(season),
    episode: String(episode),
  };
  const template = mediaType === 'movie' ? embed.movie : embed.tv;
  return template.replace(/\{(imdb_id|season|episode)\}/g, (_, key: string) => values[key]);
};
