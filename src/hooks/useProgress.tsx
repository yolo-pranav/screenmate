"use client"
import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useSyncAccount, LOCAL_KEYS, itemKey } from './useSyncAccount';
import { fetchRemoteProgress, upsertProgressEntries, deleteProgressEntry } from '@/services/sync';

export interface ProgressEntry {
  media_type: 'movie' | 'tv';
  season?: number;
  episode?: number;
  // ms epoch of the last update; entries saved before sync existed have none
  // and are treated as 0 (remote wins) during merges.
  updatedAt?: number;
}

// Pending remote deletion ("tombstone") — recorded on every remove so the
// deletion survives being offline or signed out; replayed on the next sign-in
// merge (or by flushToAccount before a sign-out) unless the remote entry was
// updated after the deletion.
interface Tombstone {
  id: number;
  media_type: 'movie' | 'tv';
  deletedAt: number;
}

interface ProgressContextType {
  updateProgress: (id: number, media_type: 'movie' | 'tv', season?: number, episode?: number) => void;
  removeProgress: (id: number) => void;
  getProgress: (id: number) => ProgressEntry | null;
  progressOrder: number[];
  // Uploads entries and replays deletions that haven't reached the account yet
  // (failed or not attempted). True once everything is on the server, or when
  // there is nothing to send or no account to send it to.
  flushToAccount: () => Promise<boolean>;
}

const ProgressContext = createContext<ProgressContextType | undefined>(undefined);

const load = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch { return fallback; }
};

const SYNC_RETRY_MS = 30_000;

export const ProgressProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [progress, setProgress] = useState<Record<number, ProgressEntry>>(() => load(LOCAL_KEYS.progress, {}));
  const [progressOrder, setProgressOrder] = useState<number[]>(() => load(LOCAL_KEYS.progressOrder, []));
  const [pendingDeletes, setPendingDeletes] = useState<Tombstone[]>(() => load(LOCAL_KEYS.progressPendingDeletes, []));
  const [syncAttempt, setSyncAttempt] = useState(0);
  // Null while signed out, or while another account's device data awaits a choice
  const { syncUserId: userId, localReset } = useSyncAccount();
  // Snapshots for reads inside callbacks/effects without adding state deps
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const orderRef = useRef(progressOrder);
  orderRef.current = progressOrder;
  const pendingRef = useRef(pendingDeletes);
  pendingRef.current = pendingDeletes;
  const syncedForUser = useRef<string | null>(null);
  const appliedReset = useRef(localReset.generation);
  // Entries confirmed on the server at the last sync or upload. Mutated in
  // place (never drives rendering) and written straight to storage.
  const [onServer] = useState(() => new Set<string>(load<string[]>(LOCAL_KEYS.progressSynced, [])));
  const markOnServer = (keys: string[], present: boolean) => {
    keys.forEach(k => present ? onServer.add(k) : onServer.delete(k));
    try { window.localStorage.setItem(LOCAL_KEYS.progressSynced, JSON.stringify([...onServer])); } catch {}
  };
  // Changes whenever the account the data syncs with changes or the local data
  // is reset. A request started before that must not record its result
  // (markOnServer/clearTombstone) once it finishes: the result belongs to the
  // old account and would corrupt the new state's bookkeeping.
  const generation = useRef(0);

  // Declared before the reset and sync effects so they see the new generation
  useEffect(() => { generation.current++; }, [userId, localReset]);

  useEffect(() => {
    try { window.localStorage.setItem(LOCAL_KEYS.progress, JSON.stringify(progress)); } catch {}
  }, [progress]);

  useEffect(() => {
    try { window.localStorage.setItem(LOCAL_KEYS.progressOrder, JSON.stringify(progressOrder)); } catch {}
  }, [progressOrder]);

  useEffect(() => {
    try { window.localStorage.setItem(LOCAL_KEYS.progressPendingDeletes, JSON.stringify(pendingDeletes)); } catch {}
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
      progressRef.current = {};
      orderRef.current = [];
      setProgress({});
      setProgressOrder([]);
    }
  }, [localReset]);

  const clearTombstone = (id: number, mediaType: 'movie' | 'tv') =>
    setPendingDeletes(prev => prev.filter(t => !(t.id === id && t.media_type === mediaType)));

  // On sign-in (or app start with a session): drop entries deleted on another
  // device, per-title newer-wins merge, push local winners, replay pending deletes.
  useEffect(() => {
    if (!userId) { syncedForUser.current = null; return; }
    if (syncedForUser.current === userId) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const remote = await fetchRemoteProgress();
      if (cancelled) return;
      if (remote === null) {
        // Network/API failure — don't pretend the remote is empty; retry later
        retryTimer = setTimeout(() => setSyncAttempt(a => a + 1), SYNC_RETRY_MS);
        return;
      }
      syncedForUser.current = userId;

      const tombs = pendingRef.current;
      const localOrder = orderRef.current;
      const remoteKeys = new Set(remote.map(r => itemKey(r.media_id, r.media_type)));
      const merged: Record<number, ProgressEntry> = {};
      for (const [idStr, entry] of Object.entries(progressRef.current)) {
        const key = itemKey(Number(idStr), entry.media_type);
        // Was on the server at the last sync and is gone now: another device
        // deleted it. Entries changed here since then were unmarked, so they
        // are kept and uploaded.
        if (!remoteKeys.has(key) && onServer.has(key)) continue;
        merged[Number(idStr)] = entry;
      }
      const overriddenTombs: Tombstone[] = [];
      const activeTombs: Tombstone[] = [];
      const nowOnServer: string[] = [];

      for (const r of remote) {
        const remoteAt = Date.parse(r.updated_at) || 0;
        const tomb = tombs.find(t => t.id === r.media_id && t.media_type === r.media_type);
        if (tomb) {
          // Deletion vs remote update: whichever happened later wins
          if (tomb.deletedAt > remoteAt) { activeTombs.push(tomb); continue; }
          overriddenTombs.push(tomb);
        }
        nowOnServer.push(itemKey(r.media_id, r.media_type));
        const localEntry = merged[r.media_id];
        if (!localEntry || remoteAt >= (localEntry.updatedAt ?? 0)) {
          merged[r.media_id] = {
            media_type: r.media_type,
            season: r.season ?? undefined,
            episode: r.episode ?? undefined,
            updatedAt: remoteAt,
          };
        }
      }
      // Tombstones with no remote counterpart have nothing left to delete
      for (const t of tombs) {
        if (!activeTombs.includes(t) && !overriddenTombs.includes(t) &&
            !remote.some(r => r.media_id === t.id && r.media_type === t.media_type)) {
          clearTombstone(t.id, t.media_type);
        }
      }

      const toPush: { mediaId: number; entry: ProgressEntry }[] = [];
      for (const [idStr, entry] of Object.entries(merged)) {
        const id = Number(idStr);
        const r = remote.find(x => x.media_id === id && x.media_type === entry.media_type);
        const remoteAt = r ? (Date.parse(r.updated_at) || 0) : -1;
        if ((entry.updatedAt ?? 0) > remoteAt) toPush.push({ mediaId: id, entry });
      }

      // Most recently updated first; ties keep their previous relative order
      const orderIndex = (id: number) => {
        const i = localOrder.indexOf(id);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      const newOrder = Object.keys(merged).map(Number).sort((a, b) =>
        ((merged[b].updatedAt ?? 0) - (merged[a].updatedAt ?? 0)) || (orderIndex(a) - orderIndex(b))
      );

      setProgress(merged);
      setProgressOrder(newOrder);
      markOnServer([...onServer], false);
      // Only marked once the upload succeeds, so a failed upload is retried at
      // the next sync instead of being mistaken for a remote deletion. That
      // includes entries the server has an older copy of: until the newer
      // local version is uploaded they count as unsynced.
      const pushedKeys = toPush.map(({ mediaId, entry }) => itemKey(mediaId, entry.media_type));
      markOnServer(nowOnServer.filter(k => !pushedKeys.includes(k)), true);
      const gen = generation.current;
      upsertProgressEntries(userId, toPush)
        .then(ok => { if (ok && generation.current === gen) markOnServer(pushedKeys, true); });

      overriddenTombs.forEach(t => clearTombstone(t.id, t.media_type));
      for (const t of activeTombs) {
        deleteProgressEntry(userId, t.id, t.media_type)
          .then(ok => { if (ok && generation.current === gen) clearTombstone(t.id, t.media_type); });
      }
    })();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, [userId, syncAttempt]);

  const updateProgress = (id: number, media_type: 'movie' | 'tv', season?: number, episode?: number) => {
    clearTombstone(id, media_type); // fresh progress cancels a pending delete
    const entry: ProgressEntry = { media_type, season, episode, updatedAt: Date.now() };
    setProgress((prev) => ({ ...prev, [id]: entry }));
    setProgressOrder((prev) => [id, ...prev.filter((v) => v !== id)]);
    // A local change the server hasn't confirmed: a deletion on another device
    // must not remove it, and the next sync uploads it if this upload fails
    const key = itemKey(id, media_type);
    markOnServer([key], false);
    if (userId) {
      const gen = generation.current;
      upsertProgressEntries(userId, [{ mediaId: id, entry }])
        .then(ok => { if (ok && generation.current === gen) markOnServer([key], true); });
    }
  };

  const removeProgress = (id: number) => {
    const entry = progressRef.current[id];
    setProgress((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setProgressOrder((prev) => prev.filter((v) => v !== id));
    if (!entry) return;
    markOnServer([itemKey(id, entry.media_type)], false);
    // Tombstone first so the deletion sticks even if the remote call fails
    setPendingDeletes(prev => [
      ...prev.filter(t => !(t.id === id && t.media_type === entry.media_type)),
      { id, media_type: entry.media_type, deletedAt: Date.now() },
    ]);
    if (userId) {
      const gen = generation.current;
      deleteProgressEntry(userId, id, entry.media_type)
        .then(ok => { if (ok && generation.current === gen) clearTombstone(id, entry.media_type); });
    }
  };

  // Before a sign-out clears the device: send what the last sync or a failed
  // request left behind, so it isn't lost with the local copy
  const flushToAccount = async (): Promise<boolean> => {
    if (!userId) return true;
    const uid = userId;
    const gen = generation.current;
    const unsynced = Object.entries(progressRef.current)
      .map(([idStr, entry]) => ({ mediaId: Number(idStr), entry }))
      .filter(({ mediaId, entry }) => !onServer.has(itemKey(mediaId, entry.media_type)));
    const tombs = pendingRef.current;
    if (unsynced.length === 0 && tombs.length === 0) return true;

    // Same newer-wins rule as the merge, so an older change made here doesn't
    // overwrite a newer one from another device, and a deletion doesn't undo
    // a later update
    const remote = await fetchRemoteProgress();
    if (remote === null || generation.current !== gen) return false;
    const remoteAt = new Map(remote.map(r => [itemKey(r.media_id, r.media_type), Date.parse(r.updated_at) || 0]));

    const toPush: { mediaId: number; entry: ProgressEntry }[] = [];
    const superseded: string[] = [];
    for (const u of unsynced) {
      const key = itemKey(u.mediaId, u.entry.media_type);
      if ((u.entry.updatedAt ?? 0) > (remoteAt.get(key) ?? -1)) toPush.push(u);
      else superseded.push(key); // the server already has a newer version
    }
    markOnServer(superseded, true);
    // Upserts are idempotent, so re-sending an entry a merge is uploading too is harmless
    const pushedKeys = toPush.map(({ mediaId, entry }) => itemKey(mediaId, entry.media_type));
    const upload = toPush.length === 0 ? Promise.resolve(true) :
      upsertProgressEntries(uid, toPush)
        .then(ok => { if (ok && generation.current === gen) markOnServer(pushedKeys, true); return ok; });

    const deletes = tombs.map(t => {
      const at = remoteAt.get(itemKey(t.id, t.media_type));
      if (at === undefined || at >= t.deletedAt) {
        clearTombstone(t.id, t.media_type); // nothing to delete, or updated later
        return Promise.resolve(true);
      }
      return deleteProgressEntry(uid, t.id, t.media_type)
        .then(ok => { if (ok && generation.current === gen) clearTombstone(t.id, t.media_type); return ok; });
    });

    const results = await Promise.all([upload, ...deletes]);
    return results.every(Boolean);
  };

  const getProgress = (id: number): ProgressEntry | null => progress[id] ?? null;

  return (
    <ProgressContext.Provider value={{ updateProgress, removeProgress, getProgress, progressOrder, flushToAccount }}>
      {children}
    </ProgressContext.Provider>
  );
};

export const useProgress = (): ProgressContextType => {
  const context = useContext(ProgressContext);
  if (!context) throw new Error('useProgress must be used within a ProgressProvider');
  return context;
};
