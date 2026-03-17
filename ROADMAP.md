# Twitch Song Request Player Roadmap

This roadmap turns the current feature gap list into an implementation plan that fits the existing app structure:

- Node/Express API in `src/app-server.js`
- Playback state machine in `src/player-controller.js`
- Twitch command handling in `src/twitch-bot.js`
- Runtime settings in `src/config.js`
- Dashboard shell in `public/dashboard.js`

The goal is to make the app production-ready for active streams without collapsing the dashboard into oversized tabs.

## Planning Principles

- Keep the queue and playback state predictable first.
- Add moderation and safety controls before opening more powerful request flows.
- Prefer incremental API additions over rewrites.
- Preserve the current desktop-first workflow and OBS overlay compatibility.
- Keep settings migrations explicit and test-backed.

## Proposed Main Tab Split

The current `Overview`, `Connection`, and `Playlist` tabs are already near the point where new work will make them too dense. Expand the dashboard into these top-level tabs:

1. `Overview`
   - System status summary
   - Current track
   - Quick transport controls
   - Quick add-to-queue form
   - Overlay URL and Twitch status
2. `Playback`
   - Full now-playing panel
   - GUI player controls
   - Volume controls
   - Audio behavior settings
   - Recent playback history
3. `Queue`
   - Full live queue
   - Reorder/remove/promote controls
   - Clear queue actions
   - Queue filters and requester context
4. `Requests`
   - Song request on/off state
   - Request limits and moderation rules
   - Configurable chat commands
   - Permissions and role policy
   - Blocked users, blocked terms, blocked sources
5. `Library`
   - Fallback playlist management
   - Search, sort, bulk actions
   - Import/export
   - Broken-track review and metadata repair
6. `Settings`
   - Twitch login and API credentials
   - Port and runtime settings
   - Overlay theme and appearance
   - Update controls and diagnostics

This split keeps the app discoverable while leaving room for future features such as AutoDJ rules or alternative providers.

## Phase 1: Queue Management And Persistence

Priority: highest

### User-facing goals

- Let mods and the streamer manage the queue directly from the dashboard.
- Keep the queue, stopped track, and recent history across restarts.
- Expose enough state for users to understand what is playing, queued, stopped, and recently played.

### Features

- Queue item actions:
  - remove specific queued track
  - move queued track to top
  - move up/down
  - clear full queue
  - restart stopped track
- Queue metadata:
  - requester name
  - provider badge
  - saved/not-saved badge
  - added-at timestamp
- Playback history:
  - recent played list
  - status markers such as ended, skipped, deleted, errored
- Persistence:
  - persist `queue`, `currentTrack` recovery metadata if appropriate, `stoppedTrack`, and `history`
  - restore persisted state on startup

### Server and data changes

- Add a runtime state store, for example `queue-state.json`, beside `settings.json` and `playlist.csv`.
- Extend `PlayerController` with explicit queue mutation methods instead of only `addRequest`, `skip`, and `stop`.
- Persist after every queue mutation and playback transition.
- Restore state before `ensurePlayback()` runs on boot.
- Decide one startup rule and document it:
  - recommended: restore queue and stopped track, but do not auto-resume the interrupted track

### API work

- Add endpoints for:
  - `GET /api/queue`
  - `DELETE /api/queue/:trackId`
  - `POST /api/queue/:trackId/promote`
  - `POST /api/queue/:trackId/move`
  - `POST /api/queue/clear`
  - `GET /api/history`
- Keep `POST /api/queue` as the add endpoint.

### Dashboard work

- Create a dedicated `Queue` tab.
- Move the full queue out of `Overview`.
- Keep `Overview` limited to a short preview and quick actions.
- Add optimistic UI feedback for queue mutations.

### Tests

- `player-controller` tests for reorder, remove, clear, promote, and restore behavior
- `app-server` tests for new queue endpoints
- migration/loading tests for persisted runtime state

## Phase 2: Request Guardrails And Moderation Policy

Priority: highest

### User-facing goals

- Give streamers control over who can request songs and under what limits.
- Prevent queue abuse before it becomes an operational problem.

### Features

- Request availability:
  - global requests on/off
  - mod-only mode
  - follower/subscriber-only mode if supported by tags
- Limits:
  - per-user queued track cap
  - per-user cooldown
  - global queue length cap
  - max track duration
  - optional min account age is out of scope unless Twitch APIs make it cheap
- Moderation lists:
  - blocked users
  - blocked phrases
  - blocked domains or channels
  - allowed providers toggle
- Duplicate policy:
  - keep current duplicate detection
  - add configurable duplicate window for recent history if desired

### Server and data changes

- Extend settings schema with a `requestPolicy` object instead of scattering booleans and numbers at top level.
- Validate limits centrally before queue insertion.
- Resolve track metadata early enough to enforce duration and source rules before accepting the request.

### Bot and dashboard behavior

- When a request is denied, reply with a short specific reason.
- Surface request-policy status in the `Requests` tab and in `Overview`.
- Add a status pill for `Requests Open` or `Requests Closed`.

### Tests

- command acceptance and rejection cases
- per-user cap and cooldown tests
- duration and provider restriction tests

## Phase 3: Configurable Chat Commands

Priority: highest

This is additional scope requested for this roadmap and should ship with request-policy work, not after it.

### User-facing goals

- Let streamers rename or disable chat commands without editing code.
- Support different moderation styles across channels.

### Features

- Configurable commands for all current and planned bot actions:
  - request song
  - skip
  - delete current
  - save current
  - current song
  - queue
  - position
  - remove own request
  - open requests
  - close requests
  - clear queue
- Per-command settings:
  - enabled/disabled
  - primary trigger
  - aliases
  - permission level
  - optional reply text override later, but not required in first pass

### Recommended configuration model

- Add `chatCommands` to settings as a structured map, for example:
  - stable action id such as `song_request`
  - configurable trigger strings such as `!sr`
  - alias array
  - `enabled`
  - `permission`
- Keep action ids stable in code.
- Match user messages against configured triggers instead of hardcoded literals.
- Reject invalid collisions on save:
  - duplicate trigger used by more than one action
  - empty trigger on enabled command

### Dashboard work

- Add a `Requests` tab section for command configuration.
- Show defaults, current trigger, aliases, enabled state, and permission level.
- Include a reset-to-defaults action for commands only.

### Tests

- command parsing with renamed triggers
- alias matching
- permission enforcement after rename
- settings validation for collisions

## Phase 4: Viewer And Moderator Command Expansion

Priority: high

### User-facing goals

- Cover the common song-request workflows users expect in chat.

### New commands to add

- queue display
- requester queue position
- remove own queued song
- open requests
- close requests
- clear queue
- maybe voteskip later, but only after request guardrails are stable

### Design notes

- Avoid dumping the full queue in one chat reply. Return a concise summary plus position.
- `remove own request` should remove the earliest queued track for that requester by default.
- Open/close commands should be limited to configured moderator roles.
- Voteskip should be explicitly deferred unless there is a clear policy for vote thresholds and anti-abuse controls.

## Phase 5: Playlist And Library Upgrades

Priority: high

### User-facing goals

- Make the fallback library manageable once it grows beyond a small CSV.

### Features

- Sorting:
  - title
  - provider
  - recently added
- Bulk actions:
  - multi-select delete
  - export selected
  - move selected to queue
- Metadata actions:
  - repair missing title
  - edit title
  - inspect provider and key
- Import improvements:
  - dry-run summary before replace
  - duplicate preview
  - import YouTube playlist URLs if feasible
  - import SoundCloud sets if feasible
- Health review:
  - detect broken or unavailable items
  - mark items with repeated playback failures

### Data and API changes

- Consider moving library storage from raw CSV-only semantics to an internal JSON model that still imports/exports CSV for compatibility.
- If CSV remains the source of truth, add supplemental metadata carefully and keep export backward-compatible.

### Dashboard work

- Keep `Library` as its own tab.
- Add filters, sort controls, and bulk action toolbar.
- Keep import/export visible but separate from destructive bulk actions.

## Phase 6: Content Safety Controls

Priority: high

### User-facing goals

- Reduce the chance of bad requests getting through.

### Features

- Search safety:
  - configurable YouTube `safeSearch`
  - optional search disable while still allowing direct URLs
- Source safety:
  - blocked YouTube channel ids
  - blocked SoundCloud users
  - provider allowlist
- Query safety:
  - blocked keywords
  - blocked regex patterns only if the UI stays simple
- Request acceptance policy:
  - reject live streams if they create problems
  - reject tracks over max duration
  - optionally reject tracks without embeddable metadata when detectable

### Design notes

- Keep the first version simple and explicit.
- Prefer a few predictable controls over a large moderation DSL.
- Put these controls in the `Requests` tab, not in a generic settings dump.

## Phase 7: Audio And Playback Polish

Priority: medium

### User-facing goals

- Make playback feel less abrupt and less inconsistent between sources.

### Features

- Fade in/fade out on track transitions where provider APIs allow it
- Optional default volume per provider
- Manual track restart
- Remember last GUI player volume and expose it clearly
- Optional silence timeout diagnostics if browser playback hangs

### Deferred unless architecture changes

- true loudness normalization
- reliable crossfade between providers
- per-track gain normalization

These are harder with embedded YouTube and SoundCloud players and should not block the higher-value moderation and queue work.

## Phase 8: Diagnostics And Admin Quality Of Life

Priority: medium

### Features

- Admin activity log in dashboard:
  - who skipped
  - who deleted
  - who closed requests
- Better surfaced error states:
  - invalid token
  - unavailable track
  - queue restore failures
- One-click export of logs and settings for debugging

## Recommended Delivery Order

1. Dashboard tab split and underlying settings model cleanup
2. Queue actions and queue persistence
3. Request policy engine
4. Configurable chat commands
5. Expanded chat commands
6. Library improvements
7. Content safety controls
8. Audio polish
9. Diagnostics

## Suggested Milestones

### Milestone A: Queue Foundations

- New `Queue` and `Playback` tabs exist
- queue remove/promote/reorder/clear works
- runtime queue persistence works
- recent history exists

### Milestone B: Requests Control

- New `Requests` tab exists
- requests open/closed state exists
- per-user and global limits work
- max duration and provider restrictions work

### Milestone C: Command Reconfiguration

- commands are no longer hardcoded
- commands can be renamed, disabled, and permission-gated
- collision validation exists

### Milestone D: Library And Safety

- library sorting and bulk actions exist
- blocked users/phrases/sources exist
- safer search configuration exists

### Milestone E: Playback Polish

- better fade behavior or restart tools exist
- diagnostics and admin log are visible

## Implementation Notes By File

### `src/player-controller.js`

- Add queue mutation methods and history tracking.
- Add persistence hooks.
- Keep playback transition logic centralized here.

### `src/app-server.js`

- Add queue/history/request-policy/command-config endpoints.
- Keep the dashboard API thin and focused on explicit actions.

### `src/twitch-bot.js`

- Replace hardcoded command literals with a command registry driven by settings.
- Add permission-aware dispatch and clearer denial replies.

### `src/config.js`

- Add typed settings sections:
  - `requestPolicy`
  - `chatCommands`
  - maybe `safetyRules`
- Handle defaults and migrations from older flat settings.

### `public/dashboard.js`

- Split current views into smaller top-level tabs.
- Keep `Overview` narrow and fast to scan.
- Move advanced controls into `Playback`, `Queue`, `Requests`, `Library`, and `Settings`.

## Non-Goals For The First Pass

- Spotify playback support
- web-hosted multi-user remote dashboard
- advanced recommendation engine
- heavy role synchronization outside the Twitch tags already available
- perfect audio normalization across providers

## Definition Of Done For This Roadmap

The roadmap is complete when:

- queue operations are manageable from the dashboard
- request abuse controls are configurable
- chat commands are configurable instead of hardcoded
- the dashboard has dedicated top-level tabs for queue and requests
- the library can be managed at scale
- safety controls exist for search and sources
- the app remains test-covered and restart-safe
