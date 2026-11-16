// Keys and endpoints are served at runtime by the `screenmate` worker (see
// workers/screenmate and src/services/config.ts) — nothing secret lives here.
export const CONFIG_URL = "https://screenmate.guptapranav0144.workers.dev/config";

// Fallbacks used only until the remote config has loaded once (e.g. first
// launch while offline). Sign-in/sync stays off until then.
export const DEFAULT_TMDB_PROXY_URL = "https://tmdblive.guptapranav0144.workers.dev/?url=";
// No player URLs are built in: the app plays the title's trailer by default,
// and an account's player mode (trailer, none, or a platform's own player)
// comes from its config worker (see workers/screenmate and
// src/hooks/usePlayerConfig.tsx).

export const TMDB_API_BASE = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
