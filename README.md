# HornGaming Music Control Center

Desktop Twitch song-request player and remote controller for the standalone AutoDJ app. Music Control Center keeps Twitch, queues, moderation, OBS request playback, and the YouTube, Suno, and SoundCloud players. Standalone AutoDJ exclusively owns local music, analysis, selection, transitions, mixing, and its browser output.

## Features

- Twitch song requests and announcements
- YouTube, SoundCloud, and direct Suno playback
- Spotify links resolved to playable requests
- Persistent queues, history, moderation, request auditing, and playlist tools
- OBS request-player overlay and YouTube fallback
- Remote AutoDJ pairing, connection and activation state, current/upcoming tracks, Mix Next, request-takeover leases, and browser-output link
- Windows desktop packaging, media keys, startup integration, and updates

## Install and run

Packaged Windows builds are available from [Releases](https://github.com/AhornFPS/twitch-song-request-player/releases/latest). For development, install Node.js 22.5 or newer, then:

```bash
npm install
npm start
```

Copy `.env.example` to `.env` or configure the same values in the dashboard. A YouTube API key is needed for text searches, Spotify matching, and metadata repair; direct provider URLs do not require it.

## Connect standalone AutoDJ

Open the AutoDJ tab, use **Find AutoDJ** or enter its service URL, save the bearer token and lease duration, then enable AutoDJ. The dashboard shows responding, recently seen, or unavailable state; desired and effective activation; command application; takeover; current and upcoming tracks; Mix Next; and the browser-output link.

The integration uses versioned authenticated JSON only. Music Control Center calls AutoDJ state, activation, Mix Next, owned-request, and request handoff endpoints. It never starts or stops the AutoDJ process and never transports audio, waveforms, or analysis.

When AutoDJ is enabled, online playback fails closed until the request-takeover lease is acknowledged as applied. Owned YouTube, Suno, and SoundCloud requests are routed to AutoDJ. Unmatched requests remain normal online requests, with ownership rechecks while queued and a final check immediately before playback. Consecutive online requests share one renewable lease; the lease is released after the final request ends, is cancelled, or is skipped.

The canonical control contract is maintained in `D:\AutoDJ\docs\control-api.md` alongside the Rust implementation.

## OBS

- Request-player overlay: `http://127.0.0.1:3000/overlay`
- Standalone AutoDJ output redirect: `http://127.0.0.1:3000/autodj-output`

The generated local OBS loader keeps retrying the request-player overlay when OBS starts before the app. AutoDJ audio remains in AutoDJ's own browser output.

## Commands

```bash
npm run typecheck
npm test
npm run build
npm run build:exe
npm run build:setup
```

## Data

Development uses the repository root for settings and runtime state. Installed builds use Electron's user-data folder; portable builds keep runtime files beside the executable. Historical internal-AutoDJ databases, analysis caches, and cached audio are left untouched but are no longer read by this app.
