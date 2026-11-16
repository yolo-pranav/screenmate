# ScreenMate

A movie and TV discovery app and **OTT front-end demo**, built with Next.js and shipped as a
web app, an Electron desktop app (Windows, macOS, Linux) and Capacitor apps for Android and iOS.
See [Platforms](#platforms) for what each one gets.

Browse trending titles, search with filters, keep a watchlist and watch history that sync
across devices, and watch trailers. The video player is **pluggable**: out of the box
it plays each title's trailer, and a streaming platform can connect **its own player
and streaming server** through a small config worker — no app rebuild needed.

> ScreenMate does not host, index or link to any video content. In its default setup it only
> plays the trailers and teasers TMDB lists for a title (YouTube embeds). The embed mode is an integration point for
> platforms that operate their own licensed streaming service; only connect players for content
> you have the rights to distribute.

---

## Features

- **Trending feed**: weekly trending movies and TV shows with infinite scroll
- **Search**: multi-search across movies and TV shows with genre and language filters
- **Title pages**: details, cast, recommendations, and season/episode selection for series
- **Where to watch**: logos of the licensed services each title is available on in the
  viewer's country
- **Player**: plays the title's trailer by default; can be switched to a platform's
  own player (see [Player modes](#player-modes))
- **Watchlist & Continue Watching**: saved titles and last-watched season/episode
- **Accounts & sync** (Supabase): email + password sign-up with emailed 6-digit codes, password
  reset, sync of watchlist and watch history across devices, and in-app account deletion
- **Light / dark mode**: theme toggle that persists between sessions
- **Desktop & mobile**: Electron app and Capacitor Android and iOS apps (the mobile WebViews
  block external links and deep links)

---

## Platforms

| Platform | Package | Updates |
|---|---|---|
| Windows | NSIS installer (`ScreenMate_Setup_<version>.exe`) | Automatic: downloads in the background, then "Restart now" |
| macOS | Universal `.dmg` (Intel + Apple silicon), **not code-signed** | Announced in the app with a **Download** button that opens the release page |
| Linux | AppImage / `.deb` | Build only (`npm run build-linux`); not published by CI |
| Android | Signed APK (sideloaded) | In the app: downloads and verifies the APK, then "Install now" |
| iOS | Build from source with Xcode on a Mac | None in the app; distribution later via TestFlight / the App Store |

**macOS first launch**: the app is not signed or notarized (there is no Apple Developer ID yet),
so macOS refuses to open it the first time. Right-click ScreenMate in Applications → **Open** →
**Open**. On macOS 15 or later, if there is no **Open** button, go to **System Settings →
Privacy & Security** and click **Open Anyway**. If macOS says the app "is damaged and can't be
opened", run:

```bash
xattr -cr /Applications/ScreenMate.app
```

For the same reason the macOS app cannot install updates itself: **Download** opens the latest
release, and you replace ScreenMate in Applications with the app from the new `.dmg`.

---

## Architecture

```
 App (Next.js static export — web / Electron / Android / iOS)
   │
   ├── screenmate worker (Cloudflare)  GET /config → Supabase keys, TMDB proxy URL, player mode
   │     └── optional per-account worker (same code) chosen by profiles.worker_url
   ├── tmdblive worker (Cloudflare)    TMDB proxy — holds the TMDB API key, adds CORS
   └── Supabase                        auth, profiles, watchlist + watch-history sync
```

Nothing secret ships in the app: keys and endpoints come from the config worker at runtime
(cached for offline starts), and the TMDB API key lives only in the `tmdblive` worker.

---

## Player modes

The config worker tells the app what the player area shows (`PLAYER_MODE`):

| Mode | What the player shows |
|---|---|
| `trailer` *(default)* | A YouTube trailer from TMDB's video list (official trailers first, then other trailers, then teasers; English preferred, newest first), or "No trailer available for this title." over the backdrop |
| `embed` | The platform's own player, loaded from URL templates the worker provides |
| `none` | No player: the title's dimmed backdrop with no video |

### Connecting your own streaming server (`embed`)

A platform runs its own player page (for example `https://player.example.com/…`) that looks up
the title in its catalogue and streams it. The worker gives the app two URL templates; the app
fills in the placeholders and loads the result in the player frame:

| Variable | Placeholders | Example |
|---|---|---|
| `EMBED_MOVIE_URL` | `{imdb_id}` | `https://player.example.com/movie/{imdb_id}` |
| `EMBED_TV_URL` | `{imdb_id}` `{season}` `{episode}` | `https://player.example.com/tv/{imdb_id}/{season}/{episode}` |

Both templates must start with `https://` and contain every listed placeholder; otherwise the
worker reports a problem and the app rejects the config.

The IMDb id identifies the title (taken from TMDB's external ids); titles without one show
"Playback isn't available for this title yet" instead of the player. Season and episode come
from the episode picker.

### Per-account configuration

Every account has a `worker_url` in the Supabase `profiles` table (new accounts get the
default `screenmate` worker). Pointing an account at a different deployment of the same worker
gives that account that deployment's player — e.g. trailers for everyone, and the platform's
player for accounts with an active subscription.

- Set `worker_url` server-side (SQL editor, the Supabase dashboard, or a service-role backend
  such as a billing webhook); users can read their row but not change it.
- Only the `player` section of that deployment's config is used. If it refuses the account
  (401/403), the app falls back to the default player.
- The default worker (the one `CONFIG_URL` points at) must keep `ACCESS=public`, since the app
  fetches it before anyone signs in. Every other deployment needs the same `SUPABASE_URL` and
  `SUPABASE_ANON_KEY`.
- With `ACCESS=profile`, a deployment only hands its config, and so its player URLs, to
  signed-in users whose `worker_url` points at it. That keeps the player out of other accounts'
  apps, but the embed URLs are ordinary links: **the platform's player and streaming server
  must still check entitlement themselves.**

See the variable reference in
[workers/screenmate/index.js](workers/screenmate/index.js) and the table setup in
[SUPABASE_SETUP.md](SUPABASE_SETUP.md).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, static export), React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Data | TMDB API via the `tmdblive` Cloudflare Worker |
| Config | `screenmate` Cloudflare Worker (`/config`) |
| Accounts & sync | Supabase (auth, Postgres with row-level security) |
| Desktop | Electron (electron-builder) |
| Mobile | Capacitor 8 (Android, iOS) |

---

## Project Structure

```
screenmate/
├── src/
│   ├── app/
│   │   ├── page.tsx                 # Home: trending, continue watching, watchlist
│   │   ├── search/                  # Search with filters
│   │   ├── player/                  # Title page + player
│   │   ├── watchlist/               # Saved titles
│   │   ├── continue-watching/       # Watch history
│   │   └── layout.tsx               # Providers, header
│   ├── components/
│   │   ├── PlayerView.tsx           # Player area: trailer / embed / none
│   │   ├── AccountModal.tsx         # Sign in, sign up, reset password, delete account
│   │   ├── DeviceDataChoice.tsx     # Merge-or-start-fresh prompt on account switch
│   │   ├── Header.tsx, MovieCard.tsx, MediaPreviewModal.tsx
│   │   ├── SeasonSelector.tsx, EpisodeList.tsx
│   │   └── ContinueWatching.tsx, WatchlistSection.tsx
│   ├── hooks/
│   │   ├── useAuth.tsx              # Supabase auth
│   │   ├── usePlayerConfig.tsx      # Player mode for the signed-in account
│   │   ├── useWatchlist.tsx         # Watchlist + sync
│   │   ├── useProgress.tsx          # Watch history + sync
│   │   ├── useSyncAccount.tsx       # Which account the device data belongs to
│   │   └── useTheme.tsx, useInfiniteScroll.ts, useBackButton.tsx
│   ├── services/
│   │   ├── config.ts                # Runtime config from the screenmate worker
│   │   ├── tmdb.ts                  # TMDB API calls (through the proxy)
│   │   ├── supabase.ts, sync.ts     # Supabase client and sync tables
│   ├── types.ts
│   └── constants.ts                 # Config worker URL, TMDB base URLs
├── workers/
│   ├── screenmate/                  # Config worker (player mode, keys, access rules)
│   └── tmdblive/                    # TMDB proxy worker
├── main/                            # Electron main process
├── android/                         # Capacitor Android project
├── ios/                             # Capacitor iOS project (Xcode, Swift Package Manager)
├── resources/                       # App icons
├── SUPABASE_SETUP.md                # Database, email and SMTP setup
└── capacitor.config.ts, electron-builder.yaml, next.config.mjs
```

---

## Getting Started

### Prerequisites — Web / Desktop

| Requirement | Version | Download |
|---|---|---|
| Node.js | 22+ (Next.js 16 needs 20.9+, the Capacitor 8 CLI needs 22+) | [nodejs.org](https://nodejs.org/en/download) |
| npm | 9+ | Bundled with Node.js |

### Prerequisites — Android

| Requirement | Version | Download |
|---|---|---|
| Java JDK | 21 (LTS) | [Eclipse Temurin](https://adoptium.net/temurin/releases/?version=21) |
| Android Studio *(recommended)* | latest | [developer.android.com/studio](https://developer.android.com/studio) |
| Android Command-line Tools *(alternative)* | latest | [developer.android.com/tools](https://developer.android.com/tools/releases/cmdline-tools) |
| Android Build Tools | 35.0.0 | via `sdkmanager "build-tools;35.0.0"` |
| Android Platform | API 36 | via `sdkmanager "platforms;android-36"` |
| Android Platform Tools | latest | via `sdkmanager "platform-tools"` · includes `adb` |
| Gradle | 8.14.3 | Fetched automatically by the Gradle wrapper |
| Min Android version | API 24 | Android 7.0 Nougat |
| Target Android version | API 36 | Android 16 |

Set these environment variables before building:

```bash
# macOS / Linux
export JAVA_HOME=/path/to/jdk-21
export ANDROID_HOME=/path/to/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH

# Windows (PowerShell)
$env:JAVA_HOME = "C:\Path\To\jdk-21"
$env:ANDROID_HOME = "C:\Path\To\android-sdk"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
```

Install the required SDK components (one-time setup; Android Studio's SDK Manager works too):

```bash
sdkmanager "platforms;android-36" "build-tools;35.0.0" "platform-tools"
```

### Prerequisites — iOS

| Requirement | Version | Download |
|---|---|---|
| A Mac | Xcode only runs on macOS | — |
| Xcode | latest stable release | [Mac App Store](https://apps.apple.com/app/xcode/id497799835) |
| Xcode Command Line Tools | matching Xcode | `xcode-select --install` |
| Min iOS version | iOS 15.0 | — |
| CocoaPods | not needed | The project uses Swift Package Manager |

Running on a simulator needs nothing else. Running on your own iPhone needs an Apple ID added
in Xcode (**Settings → Accounts**) and a signing team chosen for the App target; a free account
works, but its builds expire after 7 days.

### Install dependencies

```bash
npm install
```

### Run in development

```bash
npm run dev          # Next.js dev server + Electron window
npx next dev         # web only, at http://localhost:3000
```

---

## Configuration

The app needs two Cloudflare Workers and a Supabase project. Until the config worker has
answered once on a device, the app still browses (through `DEFAULT_TMDB_PROXY_URL`) and plays
trailers, but sign-in and sync stay off. After that the last good config is cached, so the app
keeps working if the worker is later unreachable.

1. **Supabase**: create the project, tables, profiles and email settings in
   [SUPABASE_SETUP.md](SUPABASE_SETUP.md). You need its URL and anon key next.
2. **TMDB proxy** (`workers/tmdblive`): `npx wrangler secret put TMDB_API_KEY`, then
   `npx wrangler deploy`.
3. **Config worker** (`workers/screenmate`): set `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `TMDB_PROXY_URL` (`https://tmdblive.<account>.workers.dev/?url=`, ending in `?url=`);
   optionally `PLAYER_MODE` (default `trailer`; `embed` also needs `EMBED_MOVIE_URL` /
   `EMBED_TV_URL`) and `ACCESS` (default `public`). Then `npx wrangler deploy`. A
   misconfigured worker answers `/config` with a list of the problems.
4. **Point the app at your deployments**:
   - [src/constants.ts](src/constants.ts): `CONFIG_URL` (`https://<config-worker>/config`) and
     `DEFAULT_TMDB_PROXY_URL` (`https://<tmdblive-worker>/?url=`).
   - [main/youtubeEmbeds.js](main/youtubeEmbeds.js): `EMBED_REFERER`, the origin YouTube sees
     for desktop trailers.
   - The `worker_url` default in the profiles SQL in SUPABASE_SETUP.md: your config worker's
     origin, the same origin as `CONFIG_URL`. Otherwise every account is treated as using a
     different worker.

---

## Building

### Web (static export)

```bash
npm run build-next
# Output in /out
```

### Desktop (Electron)

```bash
npm run build-next    # always first: Electron packages the static export in /out
npm run build-win     # Windows
npm run build-mac     # macOS: unsigned universal .dmg + .zip (must run on a Mac)
npm run build-linux   # Linux
npm run build-mwl     # all three (macOS targets need a Mac)
# or: npm run build   # next build + electron-builder for the current OS
```

Installers are written to `dist/`.

### Android APK

```bash
# 1. Build the static web app
npm run build-next

# 2. Sync web assets into the Android project
npx cap sync android

# 3. Build the debug APK
cd android
./gradlew assembleDebug
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

To install on a connected device or emulator:

```bash
# USB / emulator
adb install android/app/build/outputs/apk/debug/app-debug.apk

# Wi-Fi (Android 11+) — pair first, then connect
adb pair <ip>:<pairing-port>       # enter 6-digit code shown on device
adb connect <ip>:<port>
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

### iOS (on a Mac)

```bash
# 1. Build the static web app
npm run build-next

# 2. Copy it into the Xcode project and open Xcode
npx cap sync ios && npx cap open ios
```

In Xcode, pick a simulator or a connected iPhone and press **Run**. Run `npx cap sync ios`
again after every web build. There is no in-app updater on iOS: install a newer build from Xcode
(and later from TestFlight or the App Store).

Without a Mac, the [iOS build workflow](.github/workflows/ios.yml) compiles a Simulator build on
GitHub Actions (see [RELEASING.md](RELEASING.md#ios-builds)).

---

## Releases & Auto-Update

Pushing a version tag (`npm version patch && git push --follow-tags`) makes GitHub Actions
build the Windows installer, the unsigned macOS `.dmg` and a signed Android APK and publish them
as a GitHub Release. Installed apps learn about updates from there:

- **Windows**: checks GitHub Releases on launch and every 6 hours, downloads the update in the
  background and shows "Restart now".
- **macOS**: checks the same way, but because the app is unsigned it cannot install updates
  itself; it shows "ScreenMate X is available" with a **Download** button that opens the
  release page.
- **Android**: checks the config worker's `/update/android` (which reads the latest release),
  downloads and verifies the APK, and shows "Install now"; Android then asks the user to
  confirm the install.
- **iOS**: no in-app updates. The same tag also runs a Simulator build in CI to check that the
  iOS project compiles; it is not published.

One-time setup (release keystore, repo secrets, the worker's `UPDATE_REPO`) and the release
steps are in [RELEASING.md](RELEASING.md).

---

## Android Notes

- External URLs and deep links are blocked at the WebView level — the app will not open a browser or any external app when a link is tapped
- App icon is sourced from `resources/icon.png` and generated at all mipmap densities (mdpi → xxxhdpi)
- Adaptive icon uses a dark background (`#1a1a2e`) with the icon centered at 45% of canvas size

## iOS Notes

- Like Android, the WebView blocks navigation away from the app; trailers and player embeds
  still load inside their frames
- Trailers on Android and iOS load through the config worker's `/trailer` page, because YouTube
  rejects embeds from the app's local origin
- App icon is a single 1024×1024 image made from `resources/icon.png` on the same `#1a1a2e`
  background

---

## Attribution

Movie and TV metadata, images and trailer references are provided by
[TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or
certified by TMDB. Streaming availability ("where to watch") comes from
[JustWatch](https://www.justwatch.com/), through TMDB's watch-provider data. Trailers are
played through YouTube's embedded player.
