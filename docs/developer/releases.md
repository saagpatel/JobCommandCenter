# Releases

Release process, version management, and auto-update system.

## Overview

The release system provides:

- Automated GitHub Actions workflow for building releases
- Version management script for updating all version files
- Auto-updater for seamless user updates
- Cross-platform builds (macOS, Windows, Linux)

## Initial Setup

### 1. Generate Signing Keys

```bash
pnpm exec tauri signer generate -w ~/.tauri/job-command-center.key
# Outputs private key (saved) and public key (displayed)
```

### 2. Configure GitHub Repository

Add these secrets (Settings → Secrets and variables → Actions):

- `TAURI_PRIVATE_KEY`: Content of `~/.tauri/job-command-center.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Password you set (if any)

### 3. Update Configuration

**`src-tauri/tauri.conf.json`:**

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/saagpatel/JobCommandCenter/releases/latest/download/latest.json"
      ],
      "dialog": false,
      "pubkey": "<public key from signer generate>"
    }
  }
}
```

**Bundle info in `tauri.conf.json`:**

- Set `bundle.createUpdaterArtifacts` to `true`
- Set `plugins.updater.active` to `true`
- Add the generated public key to `plugins.updater.pubkey`
- Set `VITE_UPDATER_ACTIVE=true` for the release build. Startup update checks
  and the manual menu item are fail-closed without this explicit frontend build
  opt-in. Native plugin registration separately requires
  `plugins.updater.active=true`.

## Release Process

### Bundled Python Sidecar

Release packages include a frozen `jcc-sidecar` executable next to the Tauri
application executable. The build is driven by `sidecar/uv.lock` and the pinned
PyInstaller dependency in `sidecar/pyproject.toml`.

```bash
# Build only the host-specific sidecar
pnpm run build:sidecar

# Build the app and require the bundled sidecar
pnpm run tauri:build
```

`pnpm run tauri:build` uses `src-tauri/tauri.bundle.conf.json`; normal Rust
builds and tests intentionally do not require a prebuilt sidecar. Set
`JCC_SIDECAR_BUILD_ROOT` and `JCC_SIDECAR_OUTPUT_DIR` to redirect generated
files for isolated verification. The sidecar must be built separately on every
target platform because PyInstaller does not cross-compile executables.

The frozen sidecar includes Playwright's driver, not a downloaded Chromium
browser. At runtime JCC prefers a Playwright-managed Chromium executable when
one exists and otherwise uses an installed Google Chrome executable with the
JCC profile directory. If neither exists, Settings disables platform login,
explains the missing prerequisite, and offers a no-download readiness retry.
A fully self-contained release must separately acquire, bundle, sign, and
validate a browser payload.

### Disposable release smoke

Run a built app without using the installed JCC data directory:

```bash
scripts/smoke-disposable-release.sh \
  "$PWD/src-tauri/target/release/bundle/macos/Job Command Center.app/Contents/MacOS/job-command-center"
```

The harness redirects `HOME`, blocks external HTTP(S) through a closed local
proxy, verifies the disposable database, and fails if any installed `jcc.db*`
fingerprint changes. It retains the disposable home for inspection.

For packaged sidecar lifecycle coverage, require a healthy bundled listener,
force one bounded restart, and verify that app shutdown leaves no listener:

```bash
JCC_SMOKE_REQUIRE_SIDECAR=1 \
JCC_SMOKE_RESTART_SIDECAR=1 \
JCC_SMOKE_HOLD_SECONDS=0 \
scripts/smoke-disposable-release.sh \
  "$PWD/src-tauri/target/release/bundle/macos/Job Command Center.app/Contents/MacOS/job-command-center"
```

The release workflow runs this stronger macOS preflight before any platform is
allowed to create or update the draft release.

Browser profile files are not treated as proof of an authenticated platform
session. After a successful visible login, JCC writes a non-secret verification
receipt beside the profile and considers the session authenticated only for the
current app run. After restart, Settings shows **Verification required** and
the operator must revalidate the saved profile before LinkedIn or Indeed
submissions are enabled. Indeed verification requires visible account UI on a
non-login Indeed URL; merely reaching an `indeed.com` page is insufficient.

### Simple Method

```bash
pnpm run release:prepare v1.0.0
```

This will:

1. Check git status is clean
2. Run all quality checks (`pnpm run check:all`)
3. Update versions in `package.json`, `Cargo.toml`, `tauri.conf.json`
4. Ask if you want to commit and push

Then GitHub Actions will:

1. Build the app for all platforms
2. Create a draft release
3. Generate `latest.json` for auto-updates
4. Upload all installers and signatures

Finally, manually publish the draft release on GitHub.

### Manual Method

```bash
# Update versions in package.json, Cargo.toml, tauri.conf.json
pnpm run check:all
git add .
git commit -m "chore: release v1.0.0"
git tag v1.0.0
git push origin main --tags
```

## Version Strategy

Semantic versioning (`v1.0.0`):

- **Major** (1.x.x): Breaking changes
- **Minor** (x.1.x): New features, backwards compatible
- **Patch** (x.x.1): Bug fixes

All three files must have matching versions:

- `package.json` → `"version": "1.0.0"`
- `src-tauri/Cargo.toml` → `version = "1.0.0"`
- `src-tauri/tauri.conf.json` → `"version": "1.0.0"`

## Auto-Update System

### Behavior

- Checks for updates 5 seconds after app launch
- Shows confirmation dialog when update is available
- Downloads and installs in background
- Offers to restart when complete
- Fails silently on network issues

### Update Flow

```
App Launch → (5s delay) → Check GitHub → Show Dialog → Download → Install → Restart
```

### Implementation

```typescript
// src/App.tsx
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

useEffect(() => {
  const checkForUpdates = async () => {
    try {
      const update = await check()
      if (update) {
        const shouldUpdate = confirm(`Update available: ${update.version}...`)
        if (shouldUpdate) {
          await update.downloadAndInstall()
          if (confirm('Restart to apply update?')) {
            await relaunch()
          }
        }
      }
    } catch {
      // Silent fail - don't bother user with network issues
    }
  }

  const timer = setTimeout(checkForUpdates, 5000)
  return () => clearTimeout(timer)
}, [])
```

### Manual Update Check

Users can manually check via:

- **Menu**: App → Check for Updates
- **Command Palette**: Cmd+K → "Check for Updates"

## Release Artifacts

Each release creates:

- **macOS**: `.dmg` installer
- **Windows**: `.msi` installer (when configured)
- **Linux**: `.deb` and `.AppImage` (when configured)
- **Auto-updater**: `latest.json` manifest and `.sig` signature files

## Security

All updates are cryptographically signed:

1. Private key signs releases during build
2. Public key in config verifies downloads
3. Invalid signatures are automatically rejected

## Troubleshooting

| Issue                    | Solution                                               |
| ------------------------ | ------------------------------------------------------ |
| Workflow doesn't trigger | Ensure tag starts with `v` and is pushed               |
| Build fails              | Check GitHub secrets, run `pnpm run check:all` locally |
| Updates not detected     | Verify endpoint URL and public key match               |
| Download fails           | Check signatures, file permissions, disk space         |
