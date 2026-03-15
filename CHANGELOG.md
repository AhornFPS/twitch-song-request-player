# Changelog

This file is maintained between releases and should be updated as work is completed.

## Unreleased

- Improved the OBS overlay styling with larger, higher-contrast track details for better stream readability.
- Removed the redundant `Stream Radio` header and subtitle text from the player overlay.
- Tweaked the overlay title to use a narrower regular-weight font and reduced the panel opacity slightly.
- Switched the overlay title to the bundled local font asset so it is used in OBS and included in Windows EXE builds.
- Compacted the overlay layout so the track title, artwork, and progress bar take priority and the badges/queue use less space.
- Increased the now-playing title size so the current track name is easier to read on stream.

## 1.0.1 - 2026-03-15

- Added a GitHub release workflow that bumps the app version, rolls `Unreleased` notes into a dated release section, builds the Windows EXE, and publishes the release asset.
- Added project-level changelog instructions so future changes are always recorded under `## Unreleased` before release.
- Added a root `release-menu.bat` launcher so Windows builds can be run either as a test build or as a full GitHub release from a simple prompt.
- Fixed the Windows release flow failing before version bumping because `npm.cmd` was being launched without the required `cmd.exe` wrapper.
- Fixed automatic Twitch `Current song` chat announcements so every newly playing track is posted with the same details as `!currentsong`.
