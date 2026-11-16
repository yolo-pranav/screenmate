import { useSyncExternalStore } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { DEFAULT_WORKER_ORIGIN } from '@/services/config';

// In-app updates.
//  - Electron on Windows/Linux: electron-updater in the main process downloads
//    new releases on its own; the preload bridge (main/preload.js) tells the
//    page when one is ready (action 'restart') and restarts into it on request.
//  - Electron on macOS: the app is unsigned, so updates can't be installed in
//    place; the bridge announces a newer release (action 'download') and
//    install() opens the release page in the browser.
//  - Android: the worker's /update/android endpoint describes the latest
//    GitHub release; a newer APK is downloaded by the native ApkUpdater plugin
//    and handed to the system installer when the user taps Install.
//  - iOS and plain web: nothing to do (iOS updates will come from the App Store).
// Update failures are logged and never surface to the user or break the app.

// 'restart': downloaded, restart to install. 'download': newer release
// available, install() opens its download page in the browser.
export type ElectronUpdateAction = 'restart' | 'download';

export interface ElectronUpdateStatus {
  currentVersion: string;
  readyVersion: string | null;
  action: ElectronUpdateAction;
}

export interface ScreenmateBridge {
  platform: 'electron';
  updates: {
    getStatus(): Promise<ElectronUpdateStatus>;
    onReady(cb: (info: { version: string; action: ElectronUpdateAction }) => void): () => void;
    install(): void;
  };
}

declare global {
  interface Window {
    screenmate?: ScreenmateBridge;
  }
}

export interface AndroidUpdateManifest {
  version: string;
  versionCode: number;
  apkUrl: string;
  sha256: string;
}

interface ApkUpdaterPlugin {
  download(options: { url: string; sha256?: string }): Promise<{ path: string }>;
  canInstall(): Promise<{ value: boolean }>;
  openInstallSettings(): Promise<void>;
  install(options: { path: string }): Promise<void>;
}

export type ReadyUpdate =
  | { platform: 'electron'; version: string; action: ElectronUpdateAction }
  | { platform: 'android'; version: string; versionCode: number; path: string };

type AndroidReadyUpdate = Extract<ReadyUpdate, { platform: 'android' }>;

export interface UpdateSnapshot {
  ready: ReadyUpdate | null;
  // Android: the last install attempt found "install unknown apps" switched off
  needsPermission: boolean;
  // Android: the system settings screen could not be opened from the app
  settingsUnavailable: boolean;
  // "Later" was tapped — hidden until the next launch
  dismissed: boolean;
  busy: boolean;
}

export const UPDATE_ENDPOINT = `${DEFAULT_WORKER_ORIGIN}/update/android`;
const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const LAST_CHECK_KEY = 'androidUpdateLastCheck';
const READY_KEY = 'androidUpdateReady';

// ---- Pure helpers (no platform access) ----

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export const versionCodeFor = (version: string): number | null => {
  const m = VERSION_RE.exec(version);
  if (!m) return null;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (minor > 99 || patch > 99) return null;
  return major * 10000 + minor * 100 + patch;
};

// Same rules as the worker; returns null for anything else (including the
// worker's `{}` meaning "no release published")
export const parseAndroidManifest = (raw: unknown): AndroidUpdateManifest | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'string' || typeof r.versionCode !== 'number') return null;
  if (!Number.isInteger(r.versionCode) || versionCodeFor(r.version) !== r.versionCode) return null;
  if (typeof r.apkUrl !== 'string' || !r.apkUrl.startsWith('https://')) return null;
  if (typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256)) return null;
  return { version: r.version, versionCode: r.versionCode, apkUrl: r.apkUrl, sha256: r.sha256 };
};

// `build` is the installed versionCode as reported by App.getInfo()
export const isNewerBuild = (update: { versionCode: number }, build: string | number): boolean => {
  const installed = Number(build);
  return Number.isFinite(installed) && update.versionCode > installed;
};

// A last check in the future (clock changed) counts as due
export const shouldCheck = (lastCheckAt: number, now: number): boolean =>
  lastCheckAt === 0 || now < lastCheckAt || now - lastCheckAt >= CHECK_INTERVAL_MS;

export const parseSavedReady = (raw: unknown): AndroidReadyUpdate | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'string' || typeof r.versionCode !== 'number') return null;
  if (!Number.isInteger(r.versionCode) || versionCodeFor(r.version) !== r.versionCode) return null;
  if (typeof r.path !== 'string' || !r.path) return null;
  return { platform: 'android', version: r.version, versionCode: r.versionCode, path: r.path };
};

// ---- Store ----

const INITIAL: UpdateSnapshot = {
  ready: null, needsPermission: false, settingsUnavailable: false, dismissed: false, busy: false,
};

let snapshot: UpdateSnapshot = INITIAL;
const listeners = new Set<() => void>();

const setSnapshot = (patch: Partial<UpdateSnapshot>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach(l => l());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const useUpdates = (): UpdateSnapshot =>
  useSyncExternalStore(subscribe, () => snapshot, () => INITIAL);

const logError = (what: string, err: unknown) => console.warn(`[updates] ${what}`, err);

// ---- Platform detection ----

const getBridge = (): ScreenmateBridge | null => {
  if (typeof window === 'undefined') return null;
  const b = window.screenmate;
  return b && b.platform === 'electron' && b.updates ? b : null;
};

// 'android' | 'ios' on Capacitor native builds, 'web' otherwise
const getCapacitorPlatform = async (): Promise<string> => {
  const { Capacitor } = await import('@capacitor/core');
  return Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web';
};

// Unknown or missing actions (e.g. an older preload) mean the original flow
export const parseElectronAction = (action: unknown): ElectronUpdateAction =>
  action === 'download' ? 'download' : 'restart';

let pluginPromise: Promise<ApkUpdaterPlugin> | null = null;
const getPlugin = (): Promise<ApkUpdaterPlugin> => {
  pluginPromise ??= import('@capacitor/core').then(({ registerPlugin }) =>
    registerPlugin<ApkUpdaterPlugin>('ApkUpdater'));
  return pluginPromise;
};

// ---- Electron ----

const startElectron = (bridge: ScreenmateBridge): (() => void) => {
  const markReady = (version: unknown, action: unknown) => {
    if (typeof version === 'string' && version) {
      setSnapshot({ ready: { platform: 'electron', version, action: parseElectronAction(action) } });
    }
  };
  let unsubscribe: () => void = () => {};
  try {
    unsubscribe = bridge.updates.onReady(info => markReady(info?.version, info?.action));
  } catch (err) { logError('onReady failed', err); }
  bridge.updates.getStatus()
    .then(status => markReady(status?.readyVersion, status?.action))
    .catch(err => logError('getStatus failed', err));
  return () => { try { unsubscribe(); } catch {} };
};

// ---- Android ----

// lastCheckAt is only set once a check completes (no release, nothing newer,
// already downloaded, or download finished), so failures retry on next resume
let lastCheckAt = 0;
let checking = false;

const loadLastCheckAt = (): number => {
  try {
    const n = Number(window.localStorage.getItem(LAST_CHECK_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
};

const saveLastCheckAt = (at: number) => {
  lastCheckAt = at;
  try {
    if (at) window.localStorage.setItem(LAST_CHECK_KEY, String(at));
    else window.localStorage.removeItem(LAST_CHECK_KEY);
  } catch {}
};

const loadSavedReady = (): AndroidReadyUpdate | null => {
  try { return parseSavedReady(JSON.parse(window.localStorage.getItem(READY_KEY) ?? 'null')); } catch { return null; }
};

const saveReady = (ready: AndroidReadyUpdate | null) => {
  try {
    if (ready) {
      const { version, versionCode, path } = ready;
      window.localStorage.setItem(READY_KEY, JSON.stringify({ version, versionCode, path }));
    } else {
      window.localStorage.removeItem(READY_KEY);
    }
  } catch {}
};

// Brings back a download from an earlier session while it is still newer
// than the installed build; drops it once that build is installed
const restoreAndroid = async () => {
  lastCheckAt = loadLastCheckAt();
  const saved = loadSavedReady();
  if (!saved) return;
  const { App } = await import('@capacitor/app');
  const { build } = await App.getInfo();
  if (isNewerBuild(saved, build)) setSnapshot({ ready: saved });
  else saveReady(null);
};

export const fetchAndroidManifest = async (): Promise<AndroidUpdateManifest | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(UPDATE_ENDPOINT, { signal: controller.signal });
    if (!res.ok) throw new Error(`Update check failed with ${res.status}`);
    return parseAndroidManifest(await res.json());
  } finally {
    clearTimeout(timeout);
  }
};

// Resolves when the check completed; throws (and stays due) otherwise
const runAndroidCheck = async () => {
  const manifest = await fetchAndroidManifest();
  if (!manifest) return;
  const { App } = await import('@capacitor/app');
  const { build } = await App.getInfo();
  if (!isNewerBuild(manifest, build)) return;
  const ready = snapshot.ready;
  if (ready?.platform === 'android' && ready.versionCode >= manifest.versionCode) return;
  const plugin = await getPlugin();
  const { path } = await plugin.download({ url: manifest.apkUrl, sha256: manifest.sha256 });
  if (typeof path !== 'string' || !path) throw new Error('Download returned no path');
  const update: AndroidReadyUpdate = {
    platform: 'android', version: manifest.version, versionCode: manifest.versionCode, path,
  };
  saveReady(update);
  setSnapshot({ ready: update, needsPermission: false, settingsUnavailable: false });
};

let restoring: Promise<void> = Promise.resolve();

const checkAndroid = async () => {
  if (checking) return;
  checking = true;
  try {
    await restoring;
    if (!shouldCheck(lastCheckAt, Date.now())) return;
    await runAndroidCheck();
    saveLastCheckAt(Date.now());
  } catch (err) {
    logError('Android update check failed', err);
  } finally {
    checking = false;
  }
};

const startAndroid = (): (() => void) => {
  let handle: PluginListenerHandle | null = null;
  let stopped = false;
  restoring = restoreAndroid().catch(err => logError('restore failed', err));
  checkAndroid();
  (async () => {
    try {
      const { App } = await import('@capacitor/app');
      const h = await App.addListener('resume', () => { checkAndroid(); });
      if (stopped) h.remove(); else handle = h;
    } catch (err) { logError('resume listener failed', err); }
  })();
  return () => { stopped = true; handle?.remove(); };
};

// ---- Public API ----

let started = false;
let stop: (() => void) | null = null;

// Idempotent; returns a cleanup for React effects (StrictMode-safe)
export const startUpdateChecks = (): (() => void) => {
  if (started || typeof window === 'undefined') return () => {};
  started = true;
  let cancelled = false;
  const cleanup = () => {
    cancelled = true;
    started = false;
    stop?.();
    stop = null;
  };
  try {
    const bridge = getBridge();
    if (bridge) {
      stop = startElectron(bridge);
    } else {
      // iOS has no in-app update flow and never touches the ApkUpdater plugin
      getCapacitorPlatform()
        .then(platform => { if (platform === 'android' && !cancelled) stop = startAndroid(); })
        .catch(err => logError('platform detection failed', err));
    }
  } catch (err) { logError('start failed', err); }
  return cleanup;
};

export const dismissUpdate = () => setSnapshot({ dismissed: true });

export const installUpdate = async () => {
  const ready = snapshot.ready;
  if (!ready || snapshot.busy) return;
  try {
    if (ready.platform === 'electron') {
      getBridge()?.updates.install();
      // The download page opens in the browser; nothing left to show here
      if (ready.action === 'download') setSnapshot({ dismissed: true });
      return;
    }
    setSnapshot({ busy: true });
    const plugin = await getPlugin();
    const { value } = await plugin.canInstall();
    if (!value) { setSnapshot({ needsPermission: true }); return; }
    setSnapshot({ needsPermission: false, settingsUnavailable: false });
    try {
      await plugin.install({ path: ready.path });
    } catch (err) {
      // e.g. the APK was deleted: forget it so the next start/resume downloads again
      logError('install failed, discarding download', err);
      saveReady(null);
      saveLastCheckAt(0);
      setSnapshot({ ready: null });
    }
  } catch (err) {
    logError('install failed', err);
  } finally {
    if (snapshot.busy) setSnapshot({ busy: false });
  }
};

// After returning from settings the banner offers Install again, which
// re-checks the permission before installing. If settings cannot be opened the
// banner keeps Install available and tells the user where to allow it.
export const openInstallSettings = async () => {
  try {
    const plugin = await getPlugin();
    await plugin.openInstallSettings();
    setSnapshot({ needsPermission: false });
  } catch (err) {
    logError('openInstallSettings failed', err);
    setSnapshot({ settingsUnavailable: true });
  }
};
