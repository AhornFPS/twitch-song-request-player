# Changelog

This file is maintained between releases and should be updated as work is completed.

## Unreleased

- Blocked non-playable SoundCloud channel URLs so chat requests must target a specific track.
- Prevented duplicate song requests from being added twice and now send `Song <title> already in the queue` back to Twitch chat.
- Fixed YouTube-to-SoundCloud handoffs so the old YouTube player cannot keep playing in the background after the next SoundCloud track starts.
- Clarified the desktop settings screen with inline notes explaining which Twitch and YouTube credentials are required and which features use them.
- Added a direct link in the desktop GUI to Twitch's bot authentication guide for generating the bot OAuth token.
- Added in-app Twitch bot login using Twitch's device code flow, with automatic token validation and bot username fill-in from the authenticated account.
- Bundled the root `.env` Twitch Client ID into Windows EXE builds so in-app Twitch login works without asking end users to enter the client ID manually.
- Fixed in-app Twitch bot login to request the accepted IRC scope `chat:edit` instead of the rejected `chat:write` scope.
- Moved the in-app Twitch bot login above manual credential entry and removed the Twitch Client ID and Client Secret inputs from the desktop GUI.
- Switched Twitch category-aware chat suppression to use the authenticated bot user token, so it no longer depends on Twitch client-secret app auth.
- Added GUI editors for category-based chat suppression and full playback suppression, with add-on-enter, add button, dropdown selection, and delete button controls.
- Added desktop media-key support so keyboard `Play/Pause` toggles the current track and `Next Track` skips to the next song.
- Added automatic OBS overlay self-refresh and asset cache-busting when the running app instance changes, so browser-source updates no longer require a manual OBS cache refresh after app updates.
- Simplified Twitch now-playing messages to use a bare clickable URL and removed saved-status labels from current-song and queued-track display text.

## 1.1.0 - 2026-03-15

- Added "Compact" overlay theme: slim ticker layout with stacked crimson/green/teal badges, inline UP NEXT queue bar, and artwork-left design from community mockup.
- Added "Winamp Classic" overlay theme: beveled chrome borders, blue Winamp title bar, recessed LCD green track display, segmented EQ-style progress bar, and flat playlist queue rows.
- Fixed saved OBS overlay themes and custom ports being overwritten by built-in defaults when no environment override was set.
- Fixed the desktop app shutdown so closing the main GUI also stops the background player process even if OBS still has the overlay open.
- Fixed the desktop GUI theme dropdown so all theme options stay visible before selection.
- Slightly increased the OBS overlay track title and playback time text for better readability.
- Changed the desktop GUI overlay theme picker to a dropdown that only controls the OBS player theme, not the GUI itself.
- Fixed automatic YouTube-to-SoundCloud transitions so a finished YouTube track does not restart and overlap the next SoundCloud song.
- Added a native desktop GUI for the main program so settings and credentials can be managed without a terminal window.
- Added saved OBS overlay theme selection from the desktop GUI for future player theme variants.
- Fixed the desktop GUI overlay theme cards so they align correctly and preview the selected theme immediately.
- Moved the OBS Browser Source render to `/overlay` so the main app page can stay dedicated to program controls.
- Added automatic Twitch chat reconnects after saving updated credentials, with restart notices when the local port changes.
- Fixed the desktop app appearing to do nothing on launch by opening the GUI before Twitch startup finishes in the background.
- Fixed the portable desktop app reading `settings.json` from a temporary extraction folder instead of next to the `.exe`.
- Improved portable runtime path detection so packaged desktop builds keep using the real launch folder for `settings.json` and `playlist.csv`.
- Fixed packaged desktop launches from other working directories preferring a stray `playlist.csv` over the saved `settings.json` beside the `.exe`.
- Reduced the desktop GUI to a single copyable OBS overlay URL instead of showing extra app URLs.
- Fixed the desktop GUI Twitch status badge so it refreshes after the bot finishes connecting in the background.
- Fixed the Windows desktop app leaving the OBS player service running after the GUI window was closed.

## 1.0.3 - 2026-03-15

- Fixed scrolling marquee text not working in the OBS overlay.

## 1.0.2 - 2026-03-15

- Improved the OBS overlay styling with larger, higher-contrast track details for better stream readability.
- Removed the redundant `Stream Radio` header and subtitle text from the player overlay.
- Tweaked the overlay title to use a narrower regular-weight font and reduced the panel opacity slightly.
- Switched the overlay title to the bundled local font asset so it is used in OBS and included in Windows EXE builds.
- Compacted the overlay layout so the track title, artwork, and progress bar take priority and the badges/queue use less space.
- Increased the now-playing title size so the current track name is easier to read on stream.
- Increased the now-playing title again and added a slow marquee for long track names that overflow the visible title area.
- Added a much larger blank gap in the title marquee so shorter song names do not loop back too quickly.
- Fixed short track titles showing duplicated text by hiding the marquee clone unless scrolling is active.

## 1.0.1 - 2026-03-15

- Added a GitHub release workflow that bumps the app version, rolls `Unreleased` notes into a dated release section, builds the Windows EXE, and publishes the release asset.
- Added project-level changelog instructions so future changes are always recorded under `## Unreleased` before release.
- Added a root `release-menu.bat` launcher so Windows builds can be run either as a test build or as a full GitHub release from a simple prompt.
- Fixed the Windows release flow failing before version bumping because `npm.cmd` was being launched without the required `cmd.exe` wrapper.
- Fixed automatic Twitch `Current song` chat announcements so every newly playing track is posted with the same details as `!currentsong`.
