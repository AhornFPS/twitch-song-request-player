# Twitch Song Request Player

Small Node app for OBS browser source playback, driven by Twitch chat commands.

See [ROADMAP.md](ROADMAP.md) for the planned queue, moderation, command-configuration, library, safety, and dashboard expansion work.

## Download

Grab the latest compiled Windows `.exe` directly from the [Releases](https://github.com/AhornFPS/twitch-song-request-player/releases/latest) page. You do not need to install Node or compile the app yourself if you use the pre-built release.

## Features

- `!sr <url>` queues a YouTube or SoundCloud track.
- `!sr <search terms>` searches YouTube in the music category, then queues the top result.
- `!skip` works for the broadcaster, moderators, and VIPs.
- When the queue is empty, playback falls back to a random entry from `playlist.csv`.
- When a queued song finishes normally, it is appended to `playlist.csv`.
- If a YouTube song errors during playback, matching entries are removed from `playlist.csv`.
- Ten overlay themes built-in: Aurora, Sunset, Winamp Classic, Compact, Terminal, Synthwave, Broadcast, Mixtape Deck, Noir, and Arcade.
- The app serves a dashboard at `/` and the OBS Browser Source render at `/overlay`.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example` and fill in:

   - `TWITCH_CHANNEL`: Your channel name.
   - `TWITCH_USERNAME`: Optional if you use the in-app Twitch login flow. Otherwise set the Twitch account that will connect to chat.
   - `TWITCH_OAUTH_TOKEN`: Optional if you use the in-app Twitch login flow. Otherwise set the OAuth token in the form `oauth:...`.
   - `TWITCH_CLIENT_ID`: Required for the in-app Twitch device login flow and Twitch category-aware suppression. `npm run build:exe` bundles this value from your root `.env` into the packaged app as the default client ID.
   - `TWITCH_CLIENT_SECRET`: Optional advanced setting. Not needed for the normal in-app login and category-aware suppression flow.
- `YOUTUBE_API_KEY`: Required for `!sr <search terms>` and for repairing saved YouTube playlist titles when `playlist.csv` contains `undefined`.

3. Start the app:

   ```bash
   npm start
   ```

4. The desktop app opens its own GUI window automatically.

5. If `TWITCH_CLIENT_ID` is configured, you can connect the bot account from inside the GUI with Twitch's device login flow instead of pasting the OAuth token manually.

6. In OBS, add a Browser Source pointing to:

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
   - Twitch bot username (optional when using in-app Twitch login)
   - Twitch bot OAuth token (optional when using in-app Twitch login)
   - Twitch app Client ID
   - Twitch app Client Secret (optional advanced setting)
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
- If `TWITCH_CLIENT_ID` is configured, the desktop GUI can connect the bot account using Twitch's device code flow and store the returned tokens automatically.
- Windows EXE builds bundle the root `.env` `TWITCH_CLIENT_ID` into the app as a packaged default, but do not bundle your full `.env` file or the Twitch client secret.
- The desktop GUI lets you maintain separate category lists for suppressing chat messages and suppressing playback entirely.
- If `TWITCH_CLIENT_ID` is configured, category-aware chat suppression and playback suppression use the authenticated bot user token rather than app client-secret auth.
- This project keeps queue state in memory. Restarting the process clears the live queue but keeps `playlist.csv`.
- The packaged `.exe` reads the bundled app assets internally and reads/writes `playlist.csv` and `settings.json` beside the executable.
