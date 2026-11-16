"use client"
import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useSyncAccount, LOCAL_KEYS, itemKey } from './useSyncAccount';
import { fetchRemoteWatchlist, upsertWatchlistItems, deleteWatchlistItem } from '@/services/sync';

interface WatchlistItem {
  id: number;
  media_type: 'movie' | 'tv';
}

// Pending remote deletion ("tombstone") — recorded on every remove so the
// deletion survives being offline or signed out, and is replayed on the next
// sign-in merge (or by flushToAccount before a sign-out) instead of the union
// resurrecting the item.
interface Tombstone {
  id: number;
  media_type: 'movie' | 'tv';
  deletedAt: number;
}

interface WatchlistContextType {
  watchlist: WatchlistItem[];
  addToWatchlist: (item: WatchlistItem) => void;
  removeFromWatchlist: (id: number) => void;
  isInWatchlist: (id: number) => boolean;
  // Uploads items and replays deletions that haven't reached the account yet
  // (failed or not attempted). True once everything is on the server, or when
  // there is nothing to send or no account to send it to.
  flushToAccount: () => Promise<boolean>;
}

const WatchlistContext = createContext<WatchlistContextType | undefined>(undefined);

const load = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch { return fallback; }
};

const SYNC_RETRY_MS = 30_000;

export const WatchlistProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => load(LOCAL_KEYS.watchlist, []));
  const [pendingDeletes, setPendingDeletes] = useState<Tombstone[]>(() => load(LOCAL_KEYS.watchlistPendingDeletes, []));
  const [syncAttempt, setSyncAttempt] = useState(0);
  // Null while signed out, or while another account's device data awaits a choice
  const { syncUserId: userId, localReset } = useSyncAccount();
  // Snapshots for reads inside callbacks/effects without adding state deps
  const watchlistRef = useRef(watchlist);
  watchlistRef.current = watchlist;
  const pendingRef = useRef(pendingDeletes);
  pendingRef.current = pendingDeletes;
  const syncedForUser = useRef<string | null>(null);
  const appliedReset = useRef(localReset.generation);
  // Items confirmed on the server at the last sync or upload. Mutated in place
  // (never drives rendering) and written straight to storage.
  const [onServer] = useState(() => new Set<string>(load<string[]>(LOCAL_KEYS.watchlistSynced, [])));
  const markOnServer = (keys: string[], present: boolean) => {
    keys.forEach(k => present ? onServer.add(k) : onServer.delete(k));
    try { window.localStorage.setItem(LOCAL_KEYS.watchlistSynced, JSON.stringify([...onServer])); } catch {}
  };
  // Changes whenever the account the data syncs with changes or the local data
  // is reset. A request started before that must not record its result
  // (markOnServer/clearTombstone) once it finishes: the result belongs to the
  // old account and would corrupt the new state's bookkeeping.
  const generation = useRef(0);

  // Declared before the reset and sync effects so they see the new generation
  useEffect(() => { generation.current++; }, [userId, localReset]);

  useEffect(() => {
    try { window.localStorage.setItem(LOCAL_KEYS.watchlist, JSON.stringify(watchlist)); } catch {}
  }, [watchlist]);

  useEffect(() => {
    try { window.localStorage.setItem(LOCAL_KEYS.watchlistPendingDeletes, JSON.stringify(pendingDeletes)); } catch {}
  }, [pendingDeletes]);

  // The device data was linked to a different account: drop the previous
  // account's queued deletions, or everything for "Start fresh". Declared
  // before the sync effect so it runs first when both fire in one commit.
  useEffect(() => {
    if (localReset.generation === appliedReset.current) return;
    appliedReset.current = localReset.generation;
    pendingRef.current = [];
    setPendingDeletes([]);
    // What the previous account's server held says nothing about this one's
    markOnServer([...onServer], false);
    if (localReset.scope === 'all') {
      watchlistRef.current = [];
      setWatchlist([]);
    }
  }, [localReset]);

  const clearTombstone = (id: number, mediaType: 'movie' | 'tv') =>
    setPendingDeletes(prev => prev.filter(t => !(t.id === id && t.media_type === mediaType)));

  // On sign-in (or app start with a session): union local + remote (minus
  // tombstoned items and items deleted on another device), push local-only
  // items up, replay pending deletes.
  useEffect(() => {
    if (!userId) { syncedForUser.current = null; return; }
    if (syncedForUser.current === userId) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const remote = await fetchRemoteWatchlist();
      if (cancelled) return;
      if (remote === null) {
        // Network/API failure — don't pretend the remote is empty; retry later
        retryTimer = setTimeout(() => setSyncAttempt(a => a + 1), SYNC_RETRY_MS);
        return;
      }
      syncedForUser.current = userId;

      // A tombstone loses to a re-add from another device that happened later
      const tombs = pendingRef.current;
      const activeTombs = tombs.filter(t => {
        const r = remote.find(x => x.media_id === t.id && x.media_type === t.media_type);
        return !(r && Date.parse(r.added_at) > t.deletedAt);
      });
      const overridden = tombs.filter(t => !activeTombs.includes(t));

      const remoteKeys = new Set(remote.map(r => itemKey(r.media_id, r.media_type)));
      // Was on the server at the last sync and is gone now: another device
      // deleted it. Items added here and not uploaded yet were never marked.
      const local = watchlistRef.current.filter(i => {
        const key = itemKey(i.id, i.media_type);
        return remoteKeys.has(key) || !onServer.has(key);
      });
      const merged = [...local];
      const nowOnServer: string[] = [];
      for (const r of remote) {
        const tombstoned = activeTombs.some(t => t.id === r.media_id && t.media_type === r.media_type);
        if (tombstoned) continue;
        nowOnServer.push(itemKey(r.media_id, r.media_type));
        if (!merged.some(i => i.id === r.media_id && i.media_type === r.media_type)) {
          merged.push({ id: r.media_id, media_type: r.media_type });
        }
      }
      const localOnly = local.filter(i => !remoteKeys.has(itemKey(i.id, i.media_type)));
      setWatchlist(merged);
      markOnServer([...onServer], false);
      markOnServer(nowOnServer, true);
      // Only marked once the upload succeeds, so a failed upload is retried at
      // the next sync instead of being mistaken for a remote deletion
      const localOnlyKeys = localOnly.map(i => itemKey(i.id, i.media_type));
      const gen = generation.current;
      upsertWatchlistItems(userId, localOnly.map(i => ({ media_id: i.id, media_type: i.media_type })))
        .then(ok => { if (ok && generation.current === gen) markOnServer(localOnlyKeys, true); });

      overridden.forEach(t => clearTombstone(t.id, t.media_type));
      for (const t of activeTombs) {
        if (!remote.some(r => r.media_id === t.id && r.media_type === t.media_type)) {
          clearTombstone(t.id, t.media_type); // nothing to delete remotely
          continue;
        }
        deleteWatchlistItem(userId, t.id, t.media_type)
          .then(ok => { if (ok && generation.current === gen) clearTombstone(t.id, t.media_type); });
      }
    })();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, [userId, syncAttempt]);

  const addToWatchlist = (item: WatchlistItem) => {
    clearTombstone(item.id, item.media_type); // re-adding cancels a pending delete
    setWatchlist((prev) => prev.some((i) => i.id === item.id && i.media_type === item.media_type) ? prev : [...prev, item]);
    // Not on the server until the upload succeeds (signed out or offline: the
    // next sync uploads it)
    const key = itemKey(item.id, item.media_type);
    markOnServer([key], false);
    if (userId) {
      const gen = generation.current;
      upsertWatchlistItems(userId, [{ media_id: item.id, media_type: item.media_type }])
        .then(ok => { if (ok && generation.current === gen) markOnServer([key], true); });
    }
  };

  const removeFromWatchlist = (id: number) => {
    const removed = watchlistRef.current.filter((item) => item.id === id);
    setWatchlist((prev) => prev.filter((item) => item.id !== id));
    markOnServer(removed.map(i => itemKey(i.id, i.media_type)), false);
    const gen = generation.current;
    removed.forEach((item) => {
      // Tombstone first so the deletion sticks even if the remote call fails
      setPendingDeletes(prev => [
        ...prev.filter(t => !(t.id === item.id && t.media_type === item.media_type)),
        { id: item.id, media_type: item.media_type, deletedAt: Date.now() },
      ]);
      if (userId) {
        deleteWatchlistItem(userId, item.id, item.media_type)
          .then(ok => { if (ok && generation.current === gen) clearTombstone(item.id, item.media_type); });
      }
    });
  };

  // Before a sign-out clears the device: send what the last sync or a failed
  // request left behind, so it isn't lost with the local copy
  const flushToAccount = async (): Promise<boolean> => {
    if (!userId) return true;
    const uid = userId;
    const gen = generation.current;
    const unsynced = watchlistRef.current.filter(i => !onServer.has(itemKey(i.id, i.media_type)));
    const tombs = pendingRef.current;
    if (unsynced.length === 0 && tombs.length === 0) return true;

    // Upserts are idempotent, so re-sending an item a merge is uploading too is harmless
    const unsyncedKeys = unsynced.map(i => itemKey(i.id, i.media_type));
    const upload = unsynced.length === 0 ? Promise.resolve(true) :
      upsertWatchlistItems(uid, unsynced.map(i => ({ media_id: i.id, media_type: i.media_type })))
        .then(ok => { if (ok && generation.current === gen) markOnServer(unsyncedKeys, true); return ok; });

    const replay = tombs.length === 0 ? Promise.resolve(true) : (async () => {
      // Same rule as the merge: a re-add on another device after the deletion wins
      const remote = await fetchRemoteWatchlist();
      if (remote === null || generation.current !== gen) return false;
      const results = await Promise.all(tombs.map(t => {
        const r = remote.find(x => x.media_id === t.id && x.media_type === t.media_type);
        if (!r || Date.parse(r.added_at) > t.deletedAt) {
          clearTombstone(t.id, t.media_type); // nothing to delete, or re-added later
          return true;
        }
        return deleteWatchlistItem(uid, t.id, t.media_type)
          .then(ok => { if (ok && generation.current === gen) clearTombstone(t.id, t.media_type); return ok; });
      }));
      return results.every(Boolean);
    })();

    const [uploaded, replayed] = await Promise.all([upload, replay]);
    return uploaded && replayed;
  };

  const isInWatchlist = (id: number) => watchlist.some((item) => item.id === id);

  return (
    <WatchlistContext.Provider value={{ watchlist, addToWatchlist, removeFromWatchlist, isInWatchlist, flushToAccount }}>
      {children}
    </WatchlistContext.Provider>
  );
};

export const useWatchlist = (): WatchlistContextType => {
  const context = useContext(WatchlistContext);
  if (!context) throw new Error('useWatchlist must be used within a WatchlistProvider');
  return context;
};
