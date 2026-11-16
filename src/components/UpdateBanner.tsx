"use client"
import React, { useEffect } from 'react';
import {
  useUpdates, startUpdateChecks, installUpdate, dismissUpdate, openInstallSettings,
} from '@/services/updates';

// Small card announcing an update (Electron and Android only): downloaded and
// ready to install, or (macOS) available to download from the release page.
// z-40: above page content, below modals (z-50 and up).
const UpdateBanner: React.FC = () => {
  const { ready, needsPermission, settingsUnavailable, dismissed, busy } = useUpdates();

  useEffect(() => startUpdateChecks(), []);

  if (!ready || dismissed) return null;

  // Settings could not be opened: keep Install available (it re-checks the permission)
  const showOpenSettings = needsPermission && !settingsUnavailable;
  // macOS (unsigned): the update is only announced; Download opens the release page
  const isDownload = ready.platform === 'electron' && ready.action === 'download';
  const primaryLabel = ready.platform === 'electron'
    ? (isDownload ? 'Download' : 'Restart now')
    : 'Install now';

  const primaryBtnClass = "flex-1 py-2 rounded-xl text-sm font-semibold bg-blue-200 dark:bg-blue-800 hover:bg-blue-300 dark:hover:bg-blue-700 text-blue-900 dark:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const secondaryBtnClass = "flex-1 py-2 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:p-0 sm:w-80">
      <div role="status" aria-live="polite"
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          ScreenMate {ready.version} is {isDownload ? 'available' : 'ready'}
        </p>
        {needsPermission && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {settingsUnavailable
              ? 'Couldn’t open settings. Turn on "Install unknown apps" for ScreenMate in your system settings, then tap Install now.'
              : 'Allow ScreenMate to install updates, then come back and tap Install now.'}
          </p>
        )}
        <div className="flex gap-2 mt-3">
          {showOpenSettings ? (
            <button onClick={openInstallSettings} className={primaryBtnClass}>
              Open settings
            </button>
          ) : (
            <button onClick={installUpdate} disabled={busy} className={primaryBtnClass}>
              {primaryLabel}
            </button>
          )}
          <button onClick={dismissUpdate} className={secondaryBtnClass}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpdateBanner;
