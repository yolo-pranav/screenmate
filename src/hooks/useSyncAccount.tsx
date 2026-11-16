"use client"
import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useAuth } from './useAuth';

// localStorage keys of the device's watchlist/progress data (owned by
// useWatchlist and useProgress; listed here so ownership checks can see them)
export const LOCAL_KEYS = {
  watchlist: 'watchlist',
  watchlistPendingDeletes: 'watchlistPendingDeletes',
  progress: 'progress',
  progressOrder: 'progressOrder',
  progressPendingDeletes: 'progressPendingDeletes',
  // Items this device last saw on the server ("movie:123"), so a merge can tell
  // "deleted on another device" from "added here, not uploaded yet"
  watchlistSynced: 'watchlistSynced',
  progressSynced: 'progressSynced',
} as const;

export const itemKey = (id: number, mediaType: 'movie' | 'tv') => `${mediaType}:${id}`;

// Id of the account the device's data belongs to. Signing out clears the
// device's watchlist and watch history and this link with them; data saved
// while signed out belongs to no account and joins the next one that signs in.
const ACCOUNT_KEY = 'syncAccountId';

// Tells the data providers to clear local state: 'all' wipes the device's data,
// 'pending-deletes' only drops the queued remote deletions (they were made
// against the previous account and must not run against a different one).
// Both also forget which items were seen on the previous account's server.
export interface LocalReset {
  generation: number;
  scope: 'all' | 'pending-deletes';
}

interface SyncAccountContextType {
  // The signed-in user the device data may sync with. Null while signed out,
  // and while a different account's data is waiting for the user's choice.
  syncUserId: string | null;
  // A different account signed in and the device holds data it didn't save
  needsChoice: boolean;
  localReset: LocalReset;
  // Keep the device data and add it to the signed-in account
  mergeIntoAccount: () => void;
  // Clear the device data and use only the signed-in account's data
  startFresh: () => void;
}

const SyncAccountContext = createContext<SyncAccountContextType | undefined>(undefined);

const readJson = (key: string): unknown => {
  try { return JSON.parse(window.localStorage.getItem(key) ?? 'null'); } catch { return null; }
};

const hasLocalData = (): boolean => {
  const watchlist = readJson(LOCAL_KEYS.watchlist);
  const progress = readJson(LOCAL_KEYS.progress);
  return (Array.isArray(watchlist) && watchlist.length > 0) ||
    (!!progress && typeof progress === 'object' && Object.keys(progress).length > 0);
};

const readAccountId = (): string | null => {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(ACCOUNT_KEY); } catch { return null; }
};

export const SyncAccountProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, deviceDataClearSignal } = useAuth();
  const userId = user?.id ?? null;
  const [accountId, setAccountId] = useState<string | null>(readAccountId);
  const [askFor, setAskFor] = useState<string | null>(null);
  const [localReset, setLocalReset] = useState<LocalReset>({ generation: 0, scope: 'all' });

  const linkTo = (id: string, reset: LocalReset['scope'] | null) => {
    try { window.localStorage.setItem(ACCOUNT_KEY, id); } catch {}
    // Reset and link land in the same render, so the providers clear their
    // state before they start syncing with the new account.
    if (reset) setLocalReset(prev => ({ generation: prev.generation + 1, scope: reset }));
    setAccountId(id);
    setAskFor(null);
  };

  // Signed out: clear the device's watchlist and watch history (the account
  // keeps its synced copy) and forget which account they belonged to
  const handledClearSignal = useRef(deviceDataClearSignal);
  useEffect(() => {
    if (deviceDataClearSignal === handledClearSignal.current) return;
    handledClearSignal.current = deviceDataClearSignal;
    try { window.localStorage.removeItem(ACCOUNT_KEY); } catch {}
    setLocalReset(prev => ({ generation: prev.generation + 1, scope: 'all' }));
    setAccountId(null);
    setAskFor(null);
  }, [deviceDataClearSignal]);

  useEffect(() => {
    if (!userId || accountId === userId) { setAskFor(null); return; }
    // Data saved before any sign-in (or before accounts were tracked) joins
    // the first account that signs in.
    if (accountId === null) { linkTo(userId, null); return; }
    // A different account, but there is nothing to merge: link without asking
    // and drop the previous account's queued deletions.
    if (!hasLocalData()) { linkTo(userId, 'all'); return; }
    setAskFor(userId);
  }, [userId, accountId]);

  const needsChoice = !!userId && askFor === userId && accountId !== userId;
  const syncUserId = userId && accountId === userId ? userId : null;

  return (
    <SyncAccountContext.Provider value={{
      syncUserId, needsChoice, localReset,
      mergeIntoAccount: () => { if (userId) linkTo(userId, 'pending-deletes'); },
      startFresh: () => { if (userId) linkTo(userId, 'all'); },
    }}>
      {children}
    </SyncAccountContext.Provider>
  );
};

export const useSyncAccount = (): SyncAccountContextType => {
  const context = useContext(SyncAccountContext);
  if (!context) throw new Error('useSyncAccount must be used within a SyncAccountProvider');
  return context;
};
