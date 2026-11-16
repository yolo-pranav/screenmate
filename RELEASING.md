# Releasing ScreenMate

A release is one version tag. Pushing the tag runs [.github/workflows/release.yml](.github/workflows/release.yml), which builds the Windows installer, the macOS `.dmg` and the Android APK and attaches them to a GitHub release on this repository. Installed apps learn about updates from that release. The same tag also runs [.github/workflows/ios.yml](.github/workflows/ios.yml), which only checks that the iOS app compiles (see [iOS builds](#ios-builds)).

This guide writes the repository as `<owner>/<repo>`. Replace it with the real name of the GitHub repository that runs the workflow. The name matters in two places:

- **Android**: the `screenmate` worker's `UPDATE_REPO` variable must be set to `<owner>/<repo>` (see [step 5](#5-point-the-worker-at-the-releases)). The workflow itself uses the repository it runs in.
- **Desktop** (Windows and macOS): electron-builder takes the owner and repo from the git remote and writes them into the installed app. Build from a clone of `<owner>/<repo>`, as CI does. The macOS app also uses them for the release page its **Download** button opens.

If the repository is renamed or moved, update `UPDATE_REPO`. Desktop apps installed before the move keep checking the old name.

`package.json` `version` is the only version number. Do not edit versions anywhere else.

| Derived value | Rule | Example for 1.2.3 |
| --- | --- | --- |
| Git tag | `v` + version | `v1.2.3` |
| Android `versionName` | version | `1.2.3` |
| Android `versionCode` | major × 10000 + minor × 100 + patch | `10203` |
| iOS `MARKETING_VERSION` (CFBundleShortVersionString) | version, set by the iOS workflow | `1.2.3` |
| iOS `CURRENT_PROJECT_VERSION` (CFBundleVersion) | same formula as versionCode, set by the iOS workflow | `10203` |

Minor and patch must stay at 99 or below. Higher values would make versionCodes collide, so the build fails. The Xcode project keeps placeholder versions (1.0 / 1); CI passes the real ones to `xcodebuild`.

## One-time setup

### 1. Create the Android release keystore

Every Android update must be signed with the same key. Create it once:

```sh
keytool -genkeypair -v -keystore screenmate-release.jks -alias screenmate -keyalg RSA -keysize 4096 -validity 10000
```

- `keytool` ships with any JDK, including Android Studio (`<Android Studio>/jbr/bin/keytool`).
- Use one password for both the keystore and the key. Modern keystores (PKCS12) require it anyway.
- Keep the file outside the repository. `android/.gitignore` ignores `*.jks`, `*.keystore` and `keystore.properties`, but do not rely on that.

### 2. Back it up

Store the `.jks` file and its password in a password manager and in one offline copy. If you lose the key, no existing Android install can ever update again. Every user would have to uninstall and reinstall.

### 3. Add the repository secrets

In GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The `.jks` file, base64-encoded on one line |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | `screenmate` (the `-alias` above) |
| `ANDROID_KEY_PASSWORD` | Key password (same as the keystore password) |

Base64-encode the keystore:

```powershell
# PowerShell: copies the result to the clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes("screenmate-release.jks")) | Set-Clipboard
```

```sh
# bash, or with the GitHub CLI directly
base64 -w0 screenmate-release.jks
base64 -w0 screenmate-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
```

`GITHUB_TOKEN` is provided automatically. Do not create it.

### 4. Local signing (optional)

To build a signed release APK on your own machine, create `android/keystore.properties`:

```properties
storeFile=C:/Users/you/keys/screenmate-release.jks
storePassword=your-keystore-password
keyAlias=screenmate
keyPassword=your-keystore-password
```

- Use an absolute path with forward slashes. A backslash is an escape character in `.properties` files.
- The file is gitignored. Never commit it.
- Environment variables (`ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) take precedence over the file. CI uses them.
- Without either, release builds stay unsigned and cannot be installed.

Build locally:

```sh
npm run build-next
npx cap sync android
cd android
./gradlew assembleRelease   # gradlew.bat on Windows
```

The APK is `android/app/build/outputs/apk/release/app-release.apk`.

### 5. Point the worker at the releases

The Android app asks the `screenmate` worker for updates at `/update/android`. The worker reads the release repository from `UPDATE_REPO`.

1. Cloudflare dashboard → **Workers & Pages → screenmate → Settings → Variables and Secrets**.
2. Add a plain-text variable `UPDATE_REPO` = `<owner>/<repo>`, the repository that publishes the releases.
3. Redeploy the worker with the endpoint code:

   ```sh
   cd workers/screenmate
   npx wrangler deploy
   ```

   `keep_vars = true` keeps the dashboard variables.
4. Check it: `curl https://<your-worker>/update/android`. It returns `{}` until the first release has an `android-update.json`.

Without `UPDATE_REPO` the endpoint always returns `{}` and Android apps never see updates.

### 6. Allow the workflow to write releases

- The repository must be **public**. Apps download release files without credentials.
- **Settings → Actions → General**: Actions must be allowed.
- Under **Workflow permissions**, choose **Read and write permissions**. The workflow also requests `contents: write` itself, but an organization or repository policy can block it.

## How to release

1. Commit all changes on `main`. `npm version` refuses a dirty working tree.
2. Bump the version, commit and tag in one step:

   ```sh
   npm version patch   # 1.2.3 -> 1.2.4: fixes
   npm version minor   # 1.2.3 -> 1.3.0: features
   npm version major   # 1.2.3 -> 2.0.0: breaking changes
   ```

3. Push the commit and the tag:

   ```sh
   git push --follow-tags
   ```

4. Watch the **Actions** tab. The `windows` job runs first. The `macos` and `android` jobs start when it succeeds. The separate **iOS build** workflow runs at the same time.

The workflow fails early if the tag does not equal `v` + `package.json` version.

### What CI attaches to the release

| File | Built by | Used by |
| --- | --- | --- |
| `ScreenMate_Setup_<version>.exe` | `windows` job | Manual installs and desktop updates |
| `ScreenMate_Setup_<version>.exe.blockmap` | `windows` job | Desktop differential downloads |
| `latest.yml` | `windows` job | electron-updater: latest version, file name, checksum |
| `ScreenMate_Setup_<version>.dmg` | `macos` job | Manual installs on macOS (universal: Intel and Apple silicon) |
| `ScreenMate_Setup_<version>.dmg.blockmap` | `macos` job | Not used yet |
| `ScreenMate_<version>_mac.zip` (+ `.blockmap`) | `macos` job | Listed in `latest-mac.yml`; what a signed macOS app would install from later |
| `latest-mac.yml` | `macos` job | The macOS app: latest version |
| `ScreenMate-<version>.apk` | `android` job | Manual installs and Android updates |
| `android-update.json` | `android` job | The worker's `/update/android` endpoint |

`android-update.json` looks like this:

```json
{
  "version": "1.2.3",
  "versionCode": 10203,
  "apkUrl": "https://github.com/<owner>/<repo>/releases/download/v1.2.3/ScreenMate-1.2.3.apk",
  "sha256": "<64 lowercase hex characters>"
}
```

The `android` job also checks that the APK is signed and that its versionCode matches the formula. It fails before uploading otherwise.

The `windows` job publishes the release as soon as the installer is uploaded. Windows apps can see it right away. macOS apps see it once `latest-mac.yml` is uploaded, and Android apps once `android-update.json` is uploaded, a few minutes later. The `macos` job fails if the `.dmg`, the `.zip` or `latest-mac.yml` is missing from the release afterwards.

## How updates reach users

### Windows

- electron-updater checks the latest GitHub release on launch and every 6 hours.
- It only runs in installed builds, not in `npm run dev`.
- It downloads the new installer in the background.
- When the download finishes, a card says "ScreenMate <version> is ready" with **Restart now** and **Later**.
- **Restart now** installs immediately. **Later** installs when the app quits.
- The installer is per-machine (`perMachine: true`), so Windows shows an administrator (UAC) prompt. If the user declines, the update is not installed and is offered again on the next launch.
- Update errors are logged, never shown to the user.

### macOS

The macOS app is not code-signed (there is no Apple Developer ID yet). Squirrel.Mac, which electron-updater uses on macOS, only installs updates into a signed app, so the macOS app announces updates instead of installing them:

- It checks `latest-mac.yml` on the latest GitHub release on launch and every 6 hours, like Windows, but does not download anything.
- When a newer version exists, a card says "ScreenMate <version> is available" with **Download** and **Later**.
- **Download** opens `https://github.com/<owner>/<repo>/releases/latest` in the browser. The user downloads the new `.dmg` and drags ScreenMate to Applications, replacing the old copy. Data is kept.
- Every manual install of an unsigned app triggers Gatekeeper once. See [macOS: unsigned app](#macos-unsigned-app).

### Android

- The app asks the worker `/update/android` on launch and when it returns to the foreground, at most every 6 hours.
- If the release's versionCode is higher than the installed one, it downloads the APK and checks its SHA-256.
- A card says "ScreenMate <version> is ready" with **Install now** and **Later**.
- The first time, Android blocks installs from ScreenMate. The card shows "Allow ScreenMate to install updates" and an **Open settings** button. The user turns on **Allow from this source**, returns, and taps **Install now** again.
- Android then shows its own install prompt. The user confirms it.
- The worker caches `android-update.json` for 10 minutes.

### iOS

No in-app updates. Apple does not let apps install other builds of themselves, so iOS updates will come from TestFlight or the App Store once the app is distributed there. See [iOS builds](#ios-builds).

### Web

The plain web build has no updater. It always serves the deployed version.

## macOS builds

### What CI builds for macOS

The `macos` job in [release.yml](.github/workflows/release.yml) runs on a GitHub macOS runner after the `windows` job:

```sh
npx electron-builder --mac dmg zip --universal --publish always
```

- One universal app that runs natively on Intel and Apple silicon Macs.
- `CSC_IDENTITY_AUTO_DISCOVERY=false` and `identity: null` in [electron-builder.yaml](electron-builder.yaml) turn code signing off; hardened runtime and notarization are off too.
- No secrets are needed beyond the automatic `GITHUB_TOKEN`.
- To build locally on a Mac: `npm run build-next`, then `npm run build-mac`. The files are in `dist/`.

### macOS: unsigned app

Because the app is not signed or notarized, macOS blocks the first launch of every downloaded copy:

- macOS says it cannot verify ScreenMate: right-click (or Control-click) ScreenMate in Applications → **Open** → **Open**. On newer macOS versions without an **Open** button there, go to **System Settings → Privacy & Security** and click **Open Anyway**.
- macOS says ScreenMate "is damaged and can't be opened" (common on Apple silicon): the app is fine; the message comes from the download quarantine flag on an unsigned app. Remove the flag in Terminal:

  ```sh
  xattr -cr /Applications/ScreenMate.app
  ```

Users do this once per downloaded version, since each update is a manual install.

### Later: automatic installs on macOS

Automatic installs need an Apple Developer Program membership (paid, yearly) for a **Developer ID** certificate. Then:

1. Create a **Developer ID Application** certificate and export it as a `.p12`.
2. Add repository secrets `CSC_LINK` (the `.p12`, base64) and `CSC_KEY_PASSWORD`, plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization, and pass them to the `macos` job.
3. In `electron-builder.yaml`: remove `identity: null`, set `hardenedRuntime: true` and turn on notarization. In the workflow: remove `CSC_IDENTITY_AUTO_DISCOVERY: "false"`.
4. In `main/main.js`: let macOS use the same download-and-restart flow as Windows (`autoDownload` on, action `restart`).

The `.zip` and `latest-mac.yml` are already published, so signed apps can then update themselves. Users still on an unsigned version install the first signed version manually, once.

## iOS builds

> **Sync iOS on a Mac.** `npx cap sync ios` regenerates `ios/App/CapApp-SPM/Package.swift`. Run
> on Windows it writes Windows-style paths (`..\..\..\node_modules\...`) that Swift can't parse,
> so a Mac build fails until it is synced again on macOS. CI always syncs on macOS before
> building. If you sync on Windows, don't commit the rewritten `Package.swift` (the committed
> one uses `../../../node_modules/@capacitor/app`).

### What CI builds for iOS

[.github/workflows/ios.yml](.github/workflows/ios.yml) runs on every version tag and on demand (**Actions → iOS build → Run workflow**). On a GitHub macOS runner it:

1. Builds the web app and runs `npx cap sync ios`.
2. Builds the App target for the **iOS Simulator** with `CODE_SIGNING_ALLOWED=NO`, setting `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` from `package.json` (see the version table above).
3. Uploads the `App.app` bundle, zipped as `App-simulator.zip`, as the workflow artifact `ScreenMate-<version>-ios-simulator`, kept for 30 days.

This proves the iOS project compiles without a Mac. The build is **not attached to the release and cannot be installed on an iPhone or iPad**: Simulator builds only run in the iOS Simulator, and device builds must be signed.

To get it: open the workflow run in the **Actions** tab → **Artifacts** → download the zip. On a Mac with Xcode, install it in a simulator:

```sh
unzip ScreenMate-<version>-ios-simulator.zip   # the download from GitHub
unzip App-simulator.zip                         # the zipped App.app inside it
open -a Simulator                               # boots the default simulator
xcrun simctl install booted App.app
xcrun simctl launch booted com.yolopranav.screenmate
```

### Later: TestFlight and the App Store

Distributing to devices needs:

1. An Apple Developer Program membership (paid, yearly). The same membership covers macOS signing.
2. An App ID for `com.yolopranav.screenmate` and an app record in App Store Connect.
3. An **Apple Distribution** certificate and an App Store provisioning profile (or an App Store Connect API key so Xcode can manage signing), stored as repository secrets.
4. A workflow job that runs `xcodebuild archive` for `generic/platform=iOS` with signing on, exports an `.ipa` (`xcodebuild -exportArchive` with an `ExportOptions.plist`) and uploads it to TestFlight. Keep the version rules above; every upload needs a higher build number.
5. The App Store listing: privacy details, screenshots and review information.

Until then, iOS users run the app by building it from source in Xcode (see the README).

## One-time transition

### Android: existing installs must reinstall once

Current Android installs are signed with a debug key and have versionCode 1. Android refuses to install an APK signed with a different key over them. The first release therefore cannot update them.

Each existing user must:

1. Sign in and let sync finish, so their data is stored in their account.
2. Uninstall ScreenMate.
3. Install `ScreenMate-<version>.apk` from the latest GitHub release.
4. Sign in again. Synced data comes back.

Local data that was never synced to an account is lost on uninstall.

From then on, every release updates in place.

### Desktop: 1.0.0 has no updater

Desktop 1.0.0 cannot check for updates. Users install the first updater-enabled version manually from the latest GitHub release (`ScreenMate_Setup_<version>.exe`). It installs over 1.0.0. Later versions arrive automatically.

Make the first release `1.1.0` (`npm version minor`), so it is clearly newer than every existing 1.0.0 build.

## Troubleshooting

**Updaters do not see the release.**
Draft and pre-release releases are invisible to updaters. electron-updater and the `releases/latest/download/` URL only use the latest published, non-pre-release release. Publish the draft in GitHub, or untick "pre-release".

**Android never offers the update.**
- The new versionCode must be higher than the installed one. Never reuse or lower a version.
- Check `curl https://<your-worker>/update/android`. `{}` means `UPDATE_REPO` is unset, the latest release has no `android-update.json`, or the file failed validation.
- The worker caches the file for 10 minutes, and a missing file for 1 minute.

**Android says "App not installed" or "package conflicts with an existing package".**
The APK was signed with a different key. The keystore must never change. Restore it from the backup and release a new version. Users whose install has the other signature must uninstall once.

**The workflow fails with "Tag ... does not match package.json version".**
The tag was created by hand. Delete it and release with `npm version`:

```sh
git push --delete origin v1.2.3
git tag -d v1.2.3
```

**The `android` job fails with "app-release.apk not found".**
The build was unsigned. Check the four `ANDROID_*` secrets.

**The `android` job fails after the `windows` job succeeded.**
Desktop users can already update in the meantime.

- If the cause is outside the code (a missing or wrong secret, a flaky runner, a GitHub outage), fix it and re-run the failed job in the Actions tab. The re-run builds the same tagged commit. The upload uses `--clobber`, so re-running is safe.
- If the fix needs a code change, commit it and release a new patch version (`npm version patch`). Never move or re-create an existing tag. A re-run would not pick up the change, and desktop apps may already have installed that version.

**A release is broken.**
Do not delete it and reuse its version. Fix the bug and release a new patch version. Apps only move forward.

**The `macos` job fails with "Release ... has no file matching ...".**
electron-builder skipped the upload. Look for "skipped publishing" in the build step's log, fix the cause and re-run the job. Re-running is safe: existing files are replaced.

**macOS says ScreenMate "is damaged" or "cannot be opened".**
The app is unsigned. See [macOS: unsigned app](#macos-unsigned-app).

**The iOS build workflow fails.**
It does not affect the release. "Tag ... does not match" means the tag was created by hand. A Swift or Xcode error means the iOS project needs fixing: fix it on `main` and run the workflow again from the Actions tab.

**Windows shows "Windows protected your PC" on a manual install.**
The installer is not code-signed. Click **More info → Run anyway**.
