# Changelog

This file is maintained between releases and should be updated as work is completed.

## Unreleased

- Improved radio duplicate detection so fuzzy title matches and alternate versions of previously played tracks are filtered out across the full play history, not just the seed track.

## 2.9.2 - 2026-04-03

- Fixed automatic radio picks so tracks longer than 10 minutes are skipped instead of queueing long mixes or extended uploads.

## 2.9.1 - 2026-04-03

- Fixed radio picks so renamed uploads and version-labelled repeats of the same song are skipped within the same automatic radio run.

## 2.9.0 - 2026-04-02

- Fixed six hardcoded Aurora-cyan colours in the base overlay CSS so provider badges, save badges, status-pill glows, artwork fallbacks, progress-bar glows, and the track-enter timeline animation now follow the active theme instead of always showing Aurora tints.
- Fixed title marquee scrolling not activating in Compact, Terminal, Synthwave, Noir, and Stage overlay themes when the track name was longer than the visible area.
- Added three new structurally distinct overlay themes: Ticker (flat broadcast ticker strip with LIVE badge), HUD (angular clip-path tactical readout with amber phosphor glow), and Stage (portrait-oriented concert display with large circular artwork and centred title).

## 2.8.3 - 2026-04-01

- Fixed the Dashboard overview player so its total track time refreshes from the live playback metadata instead of staying stuck on stale request metadata.
- Fixed radio picks so YouTube Shorts are skipped instead of entering the automatic radio run.

## 2.8.2 - 2026-04-01

- Fixed radio picks so same-title covers and Topic-channel reuploads are skipped within the same radio run.

## 2.8.1 - 2026-04-01

- Fixed radio picks so alternate uploads of the same song are skipped instead of filling the 3-song radio run with repeat versions.

## 2.8.0 - 2026-03-31

- Changed the Winamp overlay theme so unsaved tracks display in red.
- Added an automatic 3-song radio run after the last queued request, seeded from that final request and filtered to skip tracks already saved in the fallback playlist.
- Changed radio tracks that finish naturally to be saved into the fallback playlist automatically.
- Added an Overview search picker so moderators can search for tracks there, preview matches, and add the chosen result to the live queue.
- Added a simple Overview playback progress readout with elapsed time, total duration, and a live progress bar for the current track.
- Added a saved overlay scale slider so theme sizes can be adjusted sharply inside the browser source instead of relying on blurry OBS window scaling.

## 2.7.0 - 2026-03-28

- Added a new Slate overlay theme with a cleaner lower-third layout and a readable subtitle line.
- Changed the Slate overlay theme to a floating, ultra-minimal layout that removes the outer card and extra status pills.

## 2.6.0 - 2026-03-22

- Added a moderator `!addplaylist` chat command to import full YouTube playlists into the fallback playlist without adding those tracks to the live queue.

## 2.5.2 - 2026-03-21

- Removed the extra provider hint text below the Requests tab allowed-provider toggles.
- Changed legacy YouTube playlist entries to upgrade to `uploader - title` when their metadata is refreshed for playback.

## 2.5.1 - 2026-03-21

- Changed Suno song requests to play directly from Suno instead of resolving to a YouTube match.

## 2.5.0 - 2026-03-21

- Added Spotify and Suno link requests by matching those shared tracks to playable YouTube results before they enter the queue, with separate request-source toggles for each provider.
- Changed YouTube song naming so uploads without an `artist - title` pattern fall back to `uploader - title`, including older playlist entries when their metadata is refreshed for playback.

## 2.4.0 - 2026-03-21

- Added Library health tracking with a review queue for saved tracks that repeatedly fail playback or metadata refreshes.
- Added a generated OBS local loader file that keeps retrying the overlay until the desktop app is up, so OBS can start before the app without needing a manual browser-source refresh.

## 2.3.0 - 2026-03-20

- Rewrote the app source and build pipeline in TypeScript on a dedicated migration branch while keeping the desktop, server, and browser bundles working.
- Fixed the TypeScript desktop runtime startup so `npm start` loads the Electron main-process APIs correctly again.
- Fixed TypeScript desktop builds resolving `playlist.csv`, `public/`, and bundled config files from `build/` instead of the real app root.
- Fixed installed desktop builds crashing during startup because the TypeScript updater loader imported `electron-updater` with the wrong module interop.

## 2.2.0 - 2026-03-19

- Added a persistent request audit log with per-requester totals so accepted, duplicate, and rejected song requests can be reviewed later or exported for future tools.
- Added a Requests-tab autosave toggle so request policy changes can save automatically or stay on manual save.

## 2.1.0 - 2026-03-18

- Tightened the Library track list so row actions stay inline and the table wastes less vertical space.
- Tightened the Library tab controls so the search and sort panel lines up with the playlist action buttons instead of leaving a large empty gap.
- Added playlist title editing, metadata refresh, and selected-row CSV export tools in the Library tab.
- Expanded request safety controls with max track duration, live-stream blocking, blocked direct-link domains, recent-playback duplicate blocking, and broader YouTube channel/account matching.
- Added a configurable embedded-player startup timeout so stuck YouTube or SoundCloud loads can be tuned or disabled from the Playback tab.
- Added a Start with Windows option in the desktop Settings tab so packaged Windows builds can launch automatically at sign-in.

## 2.0.0 - 2026-03-17

- Added configurable Twitch chat commands so streamers can rename or disable the built-in request and moderation triggers from the dashboard.
- Added dedicated Queue and Requests dashboard tabs with live queue management and request open/closed controls.
- Added persistent queue, stopped-track, and recent playback history state so restarts no longer wipe the live request workflow.
- Added request limit controls for queue size and per-user active requests so streamers can throttle song-request spam.
- Added Enter-to-save support for the request limit fields so numeric caps can be updated without clicking the global save button.
- Fixed the request limit inputs resetting back to the last saved values while you were still typing.
- Added a dedicated Playback tab, moved desktop-player controls out of Overview, and added a one-click restart action for the last stopped track.
- Added queue move up/down controls so moderators can fine-tune request order without only using Move to top.
- Added request moderation controls for access level, per-user cooldowns, provider allowlists, and blocked usernames or phrases.
- Added Library sorting plus bulk queue/delete actions so larger fallback playlists are easier to manage.
- Added a recent admin activity log in the dashboard so skips, queue changes, request toggles, and other control actions are visible.
- Added a diagnostics export download with the current settings, runtime status, playback state, history, and admin activity snapshot.

## 1.6.0 - 2026-03-17

- Added a persistent Overview GUI player toggle that can keep the embedded player active without OBS and restores its last on/off state on app launch.
- Added an Overview volume slider for the embedded GUI player, and it now restores the last saved loudness after restart without affecting OBS.
- Rebalanced the Connection tab so Category Rules has more room and the Add category field no longer gets cramped.
- Fixed the OBS overlay queue to render requested track titles and requester names as plain text so chat-driven requests cannot inject markup.

## 1.5.0 - 2026-03-17

- Simplified the desktop dashboard back to the Atlas layout and removed the GUI look switcher.
- Added an in-app playlist library with search, paging, add, delete, CSV import, and CSV export controls.
- Added a separate dashboard status badge for Twitch category lookup and OAuth health.
- Added Overview controls to queue links or searches manually and to play/pause, stop, or skip tracks from the dashboard.

## 1.4.6 - 2026-03-17

- Changed in-app Windows updates to install silently and reopen the app without showing the setup wizard again.

## 1.4.5 - 2026-03-17

- Fixed Windows update releases so installed builds can detect GitHub setup updates again.

## 1.4.4 - 2026-03-17

- version push for update flow testing

## 1.4.3 - 2026-03-17

- Fixed the desktop dashboard appearing unresponsive or blank by restoring the missing Socket.io client initialization.

## 1.4.2 - 2026-03-17

- Test version to check update flow

## 1.4.1 - 2026-03-17

- Added an interactive update flow with a prompt showing GitHub release notes.
- Users can now manually download updates with a progress bar and choose when to restart and install.
- Added an application version badge to the dashboard header.
- Suppressed update checks in development mode to prevent unnecessary prompts during testing.

## 1.4.0 - 2026-03-17

- Added silent auto-updating using electron-updater and GitHub releases.
- Changed the primary Windows build format to a standard installer (nsis) to support delta updates.
- Moved settings and playlist storage to the user's AppData folder for installed builds to prevent data loss on updates.
- Added an "Open Settings Folder" button to the dashboard to quickly locate settings.json and playlist.csv (especially for AppData migration).

## 1.3.3 - 2026-03-16

- Fixed the OBS overlay track-title marquee so it scrolls through the loop point smoothly instead of pausing and snapping at the end.

## 1.3.2 - 2026-03-16

- hardening the fix on long scrolling titles

## 1.3.1 - 2026-03-16

- Fixed OBS overlay title marquees so long track names scroll again reliably during polling reconnects and Chromium width-measurement edge cases.

## 1.3.0 - 2026-03-16

- Fixed overflowing OBS overlay track titles so marquee scrolling now loops continuously instead of stopping after one pass.
- Added six more OBS overlay themes: Terminal, Synthwave, Broadcast, Mixtape Deck, Noir, and Arcade, spanning minimal CRT, neon club, info-dense lower-third, cassette-deck, monochrome hi-fi, and retro cabinet styles.
- Fixed fallback playlist entries with `undefined` YouTube titles so the app retries their metadata through the YouTube API when those tracks are selected.
- Changed the desktop app theme dropdown to save and apply OBS overlay theme switches immediately without needing `Save settings`.
- Fixed YouTube-to-SoundCloud queue handoffs in OBS so SoundCloud tracks no longer stall at `0:00` until the browser source cache is refreshed.
- Fixed SoundCloud-to-YouTube OBS handoffs so stuck YouTube embeds at `0:00` now rebuild and self-reload before the track is skipped.
- Blocked requests for the song that is already playing and now send `Song <title> is already playing` to Twitch chat.
- Fixed blocked or broken SoundCloud embeds so the OBS player skips them instead of getting stuck on the track.
- Fixed finished SoundCloud tracks handing off to YouTube so the next YouTube track starts instead of only updating the overlay visuals.
- Fixed the Windows release menu so EXE builds and release commands run from the app repo when launched from `C:\Windows` or another folder, and failed actions now report correctly.

## 1.2.1 - 2026-03-16

- Fixed startup crashes when the configured local web port is already in use by automatically falling back to a free port and showing the active port in the desktop app.

## 1.2.0 - 2026-03-16

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
