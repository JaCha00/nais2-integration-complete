---
name: nais2-mobile-sync-planning
description: Use when planning or reviewing NAIS2 mobile Android release bundles, Tauri Android porting, APK/AAB readiness, PC/mobile sync, sync sanitization, LAN sync server, Supabase relay, pairing, or mobile release checklists.
---

# NAIS2 Mobile Sync Planning

This project-scope skill captures the reusable workflow created for the NAIS2
Tauri Android release and PC sync plan. It is intentionally narrow: use it for
planning, review, and readiness checks around mobile packaging and encrypted
metadata sync, not for unrelated NAIS2 feature work.

## Auto-Routing Contract

The frontmatter `description` is the project-local hook surface. Native OMX
`UserPromptSubmit` hooks load project skills by metadata, so prompts containing
NAIS2 plus Android, mobile release bundle, APK, AAB, Tauri Android, PC sync,
LAN sync, pairing, Supabase relay, or sync sanitizer should route here.

Do not edit `.codex/hooks.json` for this workflow. That file is managed by OMX
native hook trust state, and duplicating hook-owned activation state can make
the project startup path brittle.

## Required Reads

1. Read `.codex/skills/nais2-integration/SKILL.md` for baseline repository
   preservation constraints.
2. Read `.codex/skills/nais2-integration/references/project-index.md` for the
   source map and verifier expectations.
3. Read the current plan and checklist when they exist:
   - `docs/superpowers/plans/2026-07-08-nais2-mobile-release-sync.md`
   - `docs/nais2-mobile-release-sync-checklist.md`

## Workflow

1. Restate the target outcome, constraints, validation evidence, and stop
   condition before process detail.
2. Confirm current official docs for Tauri Android, Android signing, Tauri FS
   Android storage behavior, Tauri config bundle targets, Stronghold platform
   support, Android cleartext network policy, and Supabase Realtime before
   making version-sensitive claims.
3. Ground repository claims in files before planning:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/src/lib.rs`
   - `src/lib/indexed-db.ts`
   - `src/lib/store-snapshots.ts`
   - sensitive stores under `src/stores/`
   - responsive layout and viewport verifier scripts
4. Keep Android porting separate from sync implementation:
   - Phase 1: empty Android app boot plus generation MVP.
   - Phase 2: mobile UX MVP.
   - Phase 3: JSON-only sync model and sanitizers.
   - Phase 4: sync outbox and conflict MVP.
   - Phase 5: secret store and Android LAN network policy.
   - Phase 6: LAN PC sync agent.
   - Phase 7: optional encrypted relay.
   - Phase 8: APK/AAB release.
5. Never treat image file transfer or API token sync as default scope. Tokens,
   device paths, image thumbnails, and PC-only absolute paths require explicit
   sanitizer policy before they can cross devices.
6. Keep sidecar tagger, embedded desktop browser, desktop updater, global
   shortcuts, and PC absolute save paths behind platform gates before Android
   validation.
7. For Android build plans, require direct CLI flags:
   `npx tauri android build --apk` and `npx tauri android build --aab`. Do not
   put `apk` or `aab` in `bundle.targets`.
8. Use the current persisted sync key `nais2-wildcards`. Do not introduce
   a differently named fragment-store alias without a migration plan.

## Android Toolchain Recovery

When `tauri android init` fails before `src-tauri/gen/android/app` exists,
diagnose prerequisites in this order:

1. Resolve `JAVA_HOME` from user or machine environment and verify
   `bin/java.exe -version`.
2. Locate the SDK at `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or Android Studio's
   default `%LOCALAPPDATA%\Android\Sdk`.
3. Require `cmdline-tools/latest/bin/sdkmanager.bat`. If missing, install the
   official Android command-line tools ZIP under `cmdline-tools/latest` after
   comparing the downloaded file with the checksum published in Android's
   repository XML. The repository currently publishes a SHA-1 for this package,
   while the download page may label that value differently.
4. Install NDK Side by side through `sdkmanager`; set `NDK_HOME` to the exact
   installed NDK directory.
5. Require `rustup` rather than standalone `cargo` alone, because Tauri installs
   Android Rust targets with `rustup target add`.
6. Put `%USERPROFILE%\.cargo\bin`, Java `bin`, SDK `cmdline-tools/latest/bin`,
   SDK `platform-tools`, and NDK LLVM `bin` on the command PATH used for Android
   validation.
7. Treat Kotlin daemon root-mismatch failures across drives as warnings only if
   Gradle falls back to non-daemon compilation and still emits APK/AAB artifacts.

## Frontend Mobile Gates

When widening the Android port past Rust compile gates:

1. Expose the Tauri build platform through Vite with a stable define, then keep
   capability checks in `src/platform/runtime.ts`.
2. Keep raw embedded browser command strings inside `src/platform/browser.ts`.
   Android/mobile callers should reach `@tauri-apps/plugin-opener` instead of
   directly invoking `open_embedded_browser`, `resize_embedded_browser`, or
   related desktop commands.
3. Keep `src/services/local-tagger-server.ts` as the only startup boundary for
   the Python sidecar. It must reject unsupported mobile runtimes before health
   polling or `start_tagger`.
4. Gate UI entry points that depend on the sidecar, including Danbooru prompt
   verification, Asset Module Studio auto verification, R2 deploy, and Python
   preview controls.
5. `src/hooks/useShortcuts.ts` should no-op on mobile so touch workflows are not
   dependent on desktop keyboard bindings.
6. Extend `scripts/verify-android-port-contract.mjs` before implementation so
   `npm run test:android-port` fails until these boundaries exist.

## Physical Device QA And Idle-Loop Tracking

Use this sequence for a connected Android phone. It links the static Android
contract, Tauri's generated native capability bundle, Android runtime logs, and
the repeatable idle sampler; skipping the reinstall step can test stale native
permissions while Vite serves current TypeScript.

1. Confirm the authorized serial with `adb devices`. Let `tauri android dev`
   select the connected device; its CLI does not accept a desktop-style
   `--device` argument.
2. Start `npx tauri android dev --host 127.0.0.1 --no-watch`. The Android config
   runs Vite on `0.0.0.0`; Tauri creates the required adb port forwarding for
   the dev URL. Use `adb reverse tcp:9090 tcp:9090` only as an explicit recovery
   check when the generated forwarding is absent.
3. After any Rust, capability, plugin, or `tauri.android.conf.json` change,
   stop the existing Android dev process and reinstall. A browser hot reload is
   not evidence that the phone received a new native capability manifest.
4. Clear logcat, force-stop the package, relaunch it, and reject a run containing
   capability `not allowed` messages, Rust panics, `FATAL EXCEPTION`, process
   death, or failed startup persistence. Positive evidence should include app
   initialization and successful app-scoped backup/read operations.
5. Keep the app visible and idle, then run:

   ```powershell
   npm run test:android-idle -- -Serial <serial> -DurationSeconds 60 -IntervalSeconds 5
   ```

   The script writes samples and a summary under `.artifacts/android-idle` and
   fails on process restarts, three consecutive CPU samples at or above 20%, or
   PSS growth above 64 MiB. Inspect isolated sub-threshold spikes separately;
   they are not by themselves evidence of an infinite loop.
6. Capability contracts must include the exact FS commands used at startup.
   `fs:allow-read` and `fs:allow-write` do not implicitly grant
   `read_file`, `write_file`, or `stat`; keep those explicit permissions scoped
   to `$APPDATA/**` in `src-tauri/capabilities/mobile.json`.

## Delegation

For read-only follow-up analysis, use the project subagent
`mobile-sync-analyst`. It is designed to gather code evidence and official-doc
evidence without editing files, then return risks, open questions, and verifier
recommendations to the main agent.

## Validation

For documentation-only updates:

```powershell
git diff --check
$markers = @('TB'+'D','TO'+'DO','implement '+'later','fill in '+'details','appropriate '+'error handling','similar to '+'Task') -join '|'
rg -n $markers docs .codex/skills .codex/agents .codex/prompts
```

For implementation work, add the smallest relevant verifier from the plan first,
then run `npm run build`; run `cargo check` when Rust, Tauri config, plugins,
sidecar gating, capabilities, sync security, or mobile entry surfaces change.
