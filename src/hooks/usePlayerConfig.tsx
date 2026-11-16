"use client"
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useAuth } from './useAuth';
import { useConfig, parseConfig, parsePlayer, PlayerConfig, DEFAULT_WORKER_ORIGIN } from '@/services/config';
import { currentSupabase } from '@/services/supabase';

// Which player the signed-in user gets. Every account has a worker in
// `profiles.worker_url` (see SUPABASE_SETUP.md): the default worker's player
// comes with the base config already loaded at startup; any other worker is
// asked for its config with the user's token, and only its `player` section is
// used. Signed-out users always get the base config's player.

interface PlayerConfigContextType {
  player: PlayerConfig;
  // False until it's known which player this user gets, so the player page
  // doesn't start one kind of player and then swap to another
  isResolved: boolean;
}

// The last answer for a user. player: null = the default worker (use the base config)
interface CachedPlayer {
  userId: string;
  workerOrigin: string;
  player: PlayerConfig | null;
}

const CACHE_KEY = 'userPlayerConfig';
const FETCH_TIMEOUT_MS = 10_000;
// Same rhythm as the base config: re-check on return to foreground once stale,
// and on a slow interval otherwise
const STALE_MS = 5 * 60_000;
const POLL_MS = 30 * 60_000;

const readCache = (): CachedPlayer | null => {
  if (typeof window === 'undefined') return null;
  try {
    const c = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? 'null');
    if (!c || typeof c.userId !== 'string' || typeof c.workerOrigin !== 'string') return null;
    if (c.player === null) return { userId: c.userId, workerOrigin: c.workerOrigin, player: null };
    const player = parsePlayer(c.player);
    return player ? { userId: c.userId, workerOrigin: c.workerOrigin, player } : null;
  } catch { return null; }
};

const writeCache = (value: CachedPlayer | null) => {
  try {
    if (value) window.localStorage.setItem(CACHE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(CACHE_KEY);
  } catch {}
};

const originOf = (url: unknown): string | null => {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  try { return new URL(url).origin; } catch { return null; }
};

// Looks up the user's worker and, for a non-default one, its player.
// Returns undefined when the answer couldn't be determined (e.g. offline), so
// the caller keeps whatever it had.
const resolveForUser = async (userId: string): Promise<CachedPlayer | undefined> => {
  const supabase = currentSupabase();
  if (!supabase) return undefined;
  const { data, error } = await supabase.from('profiles').select('worker_url').maybeSingle();
  if (error) return undefined;
  const workerOrigin = originOf(data?.worker_url);
  // No profile row yet, or the default worker: the base config already has the player
  if (!workerOrigin || workerOrigin === DEFAULT_WORKER_ORIGIN) {
    return { userId, workerOrigin: DEFAULT_WORKER_ORIGIN, player: null };
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || session.user.id !== userId) return undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${workerOrigin}/config`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    });
    // The worker refused this account: treat it as a default user
    if (res.status === 401 || res.status === 403) {
      return { userId, workerOrigin: DEFAULT_WORKER_ORIGIN, player: null };
    }
    if (!res.ok) return undefined;
    const config = parseConfig(await res.json());
    return config ? { userId, workerOrigin, player: config.player } : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
};

const PlayerConfigContext = createContext<PlayerConfigContextType | undefined>(undefined);

export const PlayerConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, isLoading: authLoading } = useAuth();
  const { config } = useConfig();
  const userId = user?.id ?? null;
  const [cached, setCached] = useState<CachedPlayer | null>(readCache);
  // User id whose lookup has finished this launch (successfully or not)
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Signed out (once the session restore has finished): forget the last
  // user's player so it can't carry over on a shared device
  useEffect(() => {
    if (authLoading || userId) return;
    writeCache(null);
    setCached(null);
    setCheckedFor(null);
  }, [authLoading, userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    resolveForUser(userId)
      .catch(() => undefined)
      .then(result => {
        if (cancelled) return;
        if (result) { writeCache(result); setCached(result); }
        setCheckedFor(userId);
      });
    return () => { cancelled = true; };
  }, [userId, refreshTick]);

  // A changed worker_url reaches a running app too
  useEffect(() => {
    let lastRun = Date.now();
    const bump = () => { lastRun = Date.now(); setRefreshTick(t => t + 1); };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRun > STALE_MS) bump();
    };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(bump, POLL_MS);
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(interval); };
  }, []);

  const mine = userId && cached?.userId === userId ? cached : null;
  const player = mine?.player ?? config.player;
  const isResolved = !authLoading && (!userId || mine !== null || checkedFor === userId);

  return (
    <PlayerConfigContext.Provider value={{ player, isResolved }}>
      {children}
    </PlayerConfigContext.Provider>
  );
};

export const usePlayerConfig = (): PlayerConfigContextType => {
  const context = useContext(PlayerConfigContext);
  if (!context) throw new Error('usePlayerConfig must be used within a PlayerConfigProvider');
  return context;
};
