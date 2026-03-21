# Twitch Song Request Player

Desktop Twitch song request app for YouTube, SoundCloud, and Suno playback, with Spotify link support, an OBS overlay, a local dashboard, persistent queue state, moderation controls, and Windows packaging.

## Download

Grab the latest Windows builds from the [Releases](https://github.com/AhornFPS/twitch-song-request-player/releases/latest) page.

- Installer: `TwitchSongRequestPlayer-Setup-<version>.exe`
- Portable build: `TwitchSongRequestPlayer-Portable.exe`

You do not need Node.js if you use the packaged releases.

## Features

- Twitch chat requests for YouTube and SoundCloud links
- Spotify links that resolve into playable YouTube requests
- Direct Suno song links that play from Suno
- Separate request-source toggles for YouTube, SoundCloud, Spotify, and Suno
- Optional YouTube search requests through the YouTube Data API
- Desktop dashboard with Overview, Queue, Requests, Library, Playback, Connection, and Settings controls
- OBS browser-source overlay at `/overlay`
- Generated OBS local-file loader that can keep retrying the overlay until the desktop app finishes starting
- Request moderation controls for access level, cooldowns, provider allowlists, blocked users, blocked phrases, and duplicate protection
- Persistent queue, stopped-track, history, admin activity, and request audit state across restarts
- Playlist library tools for search, sort, import/export, metadata refresh, and bulk queue/delete actions
- In-app Twitch bot device login flow
- Desktop media key support and optional Start with Windows
- Built-in desktop updates for installed Windows builds

## Requirements

- Node.js 20 or newer for local development
- Windows for packaged desktop builds

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example`.

3. Configure the values you need:

   - `TWITCH_CHANNEL`: Your channel name
   - `TWITCH_USERNAME`: Optional if you use the in-app Twitch login flow
   - `TWITCH_OAUTH_TOKEN`: Optional if you use the in-app Twitch login flow
   - `TWITCH_CLIENT_ID`: Required for the in-app Twitch device login flow and Twitch category-aware suppression
   - `TWITCH_CLIENT_SECRET`: Optional advanced setting
   - `YOUTUBE_API_KEY`: Required for search requests, Spotify link matching, and YouTube metadata repair

4. Start the desktop app:

   ```bash
   npm start
   ```

5. The app opens its desktop window and serves the local dashboard and overlay.

## OBS Setup

You can use either setup:

1. Direct URL browser source:

```text
http://localhost:3000/overlay
```

If you change the local port in the app, use that port instead.

2. Recommended for OBS-first startup:

- Open the desktop app once and copy the `OBS local loader file` path from the Overview tab.
- In OBS Browser Source, enable `Local file` and select that generated `obs-overlay-loader.html` file.
- The loader file keeps retrying the real local overlay until the app server is available, so OBS no longer needs a manual refresh when it opens first.

## Useful Commands

Run the desktop app:

```bash
npm start
```

Run the server without Electron:

```bash
npm run start:server
```

Typecheck and build the runtime:

```bash
npm run build
```

Run the test suite:

```bash
npm test
```

## Windows Builds

Portable build:

```bash
npm run build:exe
```

Installer build:

```bash
npm run build:setup
```

Build all Windows targets:

```bash
npm run build:release
```

Build artifacts are written to `dist/`.

## Data Locations

- Development runs use the repo root for `playlist.csv`, `settings.json`, and runtime state files.
- Installed Windows builds use Electron's user-data folder.
- Portable Windows builds keep their runtime files next to the executable.

## Release Flow

- `package.json` is the single source of truth for the app version.
- Add user-visible app changes to `CHANGELOG.md` under `## Unreleased`.
- `npm run release:patch`, `npm run release:minor`, and `npm run release:major` run the release script.
- `release-menu.bat` provides a Windows prompt for test builds and release builds.
- `npm run build:exe` and `npm run build:setup` do not rewrite the changelog.

Dry run:

```bash
npm run release -- patch --dry-run
```

## Notes

- `playlist.csv` uses `Link,Title` columns.
- Spotify requests resolve to playable YouTube tracks, so they require a working `YOUTUBE_API_KEY`.
- Spotify and Suno can be allowed or blocked separately from direct YouTube requests in the Requests tab.
- The app can use the in-app Twitch device login flow instead of manual bot OAuth entry.
- Installed builds keep using the existing saved settings, playlist, queue state, and request history after upgrades.
- The local dashboard is served at `/` and the OBS overlay is served at `/overlay`.
