"use client"
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSyncAccount } from '@/hooks/useSyncAccount';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useProgress } from '@/hooks/useProgress';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Shown when an account signs in on a device whose watchlist/history belongs
// to a different account. Nothing syncs until the user picks an option.
const DeviceDataChoice: React.FC = () => {
  const { user, signOut } = useAuth();
  const { needsChoice, mergeIntoAccount, startFresh } = useSyncAccount();
  const { watchlist } = useWatchlist();
  const { progressOrder } = useProgress();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // Don't carry an old error into the next time the dialog opens
  useEffect(() => { if (!needsChoice) setSignOutError(null); }, [needsChoice]);

  if (!needsChoice || !user) return null;

  const handleCancel = async () => {
    setIsSigningOut(true);
    setSignOutError(null);
    // On success the dialog unmounts with the session; on failure it stays
    // The data here isn't this account's, so signing out must not erase it
    const { error } = await signOut({ keepDeviceData: true });
    setIsSigningOut(false);
    setSignOutError(error);
  };

  const counts = [
    watchlist.length > 0 && `${plural(watchlist.length, 'title')} in your watchlist`,
    progressOrder.length > 0 && `${plural(progressOrder.length, 'title')} in your watch history`,
  ].filter(Boolean).join(' and ');

  const email = <span className="font-medium text-gray-700 dark:text-gray-200 break-all">{user.email}</span>;
  const optionClass = "w-full text-left px-4 py-3 rounded-xl border transition-colors";

  // Above the account window (z-50), so it shows right after signing in there
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="device-data-title"
        className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6">
        <h2 id="device-data-title" className="text-xl font-bold text-gray-900 dark:text-white mb-1">
          Data on this device
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          This device has {counts} saved by a different account. What should happen to it now that you&apos;re signed in as {email}?
        </p>

        <button
          onClick={mergeIntoAccount}
          className={`${optionClass} border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50`}
        >
          <span className="block text-sm font-semibold text-blue-900 dark:text-white">Add to my account</span>
          <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Keep it here and sync it to this account.
          </span>
        </button>
        <button
          onClick={startFresh}
          className={`mt-3 ${optionClass} border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800`}
        >
          <span className="block text-sm font-semibold text-gray-900 dark:text-white">Start fresh</span>
          <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Remove it from this device and load this account&apos;s watchlist and history.
          </span>
        </button>

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
          Anything the other account already synced stays in that account.
        </p>
        {signOutError && <p className="text-red-500 text-sm mt-3">{signOutError}</p>}
        <button
          onClick={handleCancel}
          disabled={isSigningOut}
          className="mt-3 w-full text-center text-xs text-gray-500 dark:text-gray-400 hover:underline disabled:opacity-50"
        >
          {isSigningOut ? 'Signing out…' : 'Cancel and sign out'}
        </button>
      </div>
    </div>,
    document.body
  );
};

export default DeviceDataChoice;
