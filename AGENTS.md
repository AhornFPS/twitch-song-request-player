# HornGaming Music Control Center

Electron/TypeScript player and controller. Use [README.md](README.md) for the relevant player, controller, or OBS workflow and `package.json` for current scripts and the app version.

## Changelog and releases

- Add short, factual, user-focused entries to `CHANGELOG.md` under `## Unreleased` for user-visible behavior, UI, settings, performance, or bug fixes. Internal-only and documentation-only edits do not need an entry.
- Keep in-progress entries under `## Unreleased`, including when a release happens during the task. Do not modify an existing released section.
- Only the GitHub release flow moves entries into a version section. Test builds must not roll the changelog or create a release.
- `package.json` is the single source of truth for the app version.

## Local work and verification

Preserve live queues, settings, request history, playlists, credentials, and unrelated edits. Keep tests and previews isolated from the running player and external chat/OBS services.

Use `npm run typecheck` and the affected Node/TypeScript tests for code changes; `npm test` runs the broader suite when needed. Inspect the actual affected UI/player flow for behavior that tests cannot establish. A build is not proof of audible playback or an OBS result. Complete authorized work and fix regressions caused by the change before handing off; release/promotion follows the user's requested scope.
