# Twitch Song Request Player

Small Node app for OBS browser source playback, driven by Twitch chat commands.

## Download

Grab the latest compiled Windows `.exe` directly from the [Releases](https://github.com/AhornFPS/twitch-song-request-player/releases/latest) page. You do not need to install Node or compile the app yourself if you use the pre-built release.

## Features

- `!sr <url>` queues a YouTube or SoundCloud track.
- `!sr <search terms>` searches YouTube in the music category, then queues the top result.
- `!skip` works for the broadcaster, moderators, and VIPs.
- When the queue is empty, playback falls back to a random entry from `playlist.csv`.
- When a queued song finishes normally, it is appended to `playlist.csv`.
- If a YouTube song errors during playback, matching entries are removed from `playlist.csv`.
- Multiple overlay themes built-in: Default, Winamp Classic, and Compact.
- The app serves a dashboard at `/` and the OBS Browser Source render at `/overlay`.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example` and fill in:

   - `TWITCH_CHANNEL`: Your channel name.
   - `TWITCH_USERNAME`: The Twitch account that will connect to chat.
   - `TWITCH_OAUTH_TOKEN`: OAuth token for that account in the form `oauth:...`.
   - `TWITCH_CLIENT_ID`: Optional Twitch app Client ID for category-aware chat suppression.
   - `TWITCH_CLIENT_SECRET`: Optional Twitch app Client Secret for category-aware chat suppression.
   - `YOUTUBE_API_KEY`: Required only for `!sr <search terms>`.

3. Start the app:

   ```bash
   npm start
   ```

4. The desktop app opens its own GUI window automatically.

5. In OBS, add a Browser Source pointing to:

   ```text
   http://localhost:3000/overlay
   ```

## Commands

- `!sr https://youtu.be/...`
- `!sr https://soundcloud.com/...`
- `!sr artist song name`
- `!skip`
- `!delete`
- `!save`
- `!currentsong`

## EXE Build

1. Build the Windows executable:

   ```bash
   npm run build:exe
   ```

2. Run:

   ```text
   dist\TwitchSongRequestPlayer.exe
   ```

3. On first launch, the app opens its own desktop GUI window.

4. Set or update:

   - Twitch channel
   - Twitch bot username
   - Twitch bot OAuth token
   - Twitch app Client ID (optional)
   - Twitch app Client Secret (optional)
   - YouTube API key
   - Local port
   - Dashboard theme

5. Those values are saved in `settings.json` next to the `.exe`.

6. Use the desktop window for program control and the `/overlay` URL in OBS.

7. The local server still runs on the configured port, so the overlay URL remains:

   ```text
   http://localhost:3000/overlay
   ```

## Server-Only Mode

If you want to run the raw local web server without the desktop shell:

```bash
npm run start:server
```

That serves the dashboard at `http://localhost:3000/` and the OBS render at `http://localhost:3000/overlay`.

## Versioning And Releases

- `package.json` is the single source of truth for the app version and uses semantic versioning.
- Add user-visible changes to `CHANGELOG.md` under `## Unreleased` while work is in progress.
- If you want a simple Windows prompt, run `release-menu.bat` from the repo root.
- Run `npm run release -- patch` for a patch release, or replace `patch` with `minor`, `major`, or an explicit version like `1.2.0`.
- The release script bumps `package.json` and `package-lock.json`, moves `## Unreleased` into a dated version section, builds `dist/TwitchSongRequestPlayer.exe`, creates a versioned release asset, commits and tags the release, pushes `main`, and publishes the GitHub release notes from `CHANGELOG.md`.
- `npm run build:exe` and the `Build EXE for testing only` menu option do not rewrite `CHANGELOG.md`.
- Requirements: clean git working tree, `gh auth login` already completed, and the Windows build dependencies already installed.

For a safe preview without changing git or GitHub:

```bash
npm run release -- patch --dry-run
```

## Notes

- The app expects `playlist.csv` to have `Link,Title` columns.
- YouTube search uses the official YouTube Data API `search` endpoint with `videoCategoryId=10`.
- If `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are configured, outgoing chat messages are automatically suppressed while the Twitch category is `Music` or `DJs`.
- This project keeps queue state in memory. Restarting the process clears the live queue but keeps `playlist.csv`.
- The packaged `.exe` reads the bundled app assets internally and reads/writes `playlist.csv` and `settings.json` beside the executable.
