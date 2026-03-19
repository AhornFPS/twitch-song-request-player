# Twitch Song Request Player Roadmap

This roadmap now treats the shipped queue, moderation, request-policy, and dashboard work as the completed first pass and turns the remaining gaps into a second-pass implementation plan that fits the existing app structure:

- Node/Express API in `src/app-server.js`
- Playback state machine in `src/player-controller.js`
- Twitch command handling in `src/twitch-bot.js`
- Runtime settings in `src/config.js`
- Dashboard shell in `public/dashboard.js`

The goal for the second pass is to harden the app for active streams with better repair workflows, safer imports, clearer failure handling, and shared URL-validation hardening without collapsing the dashboard into oversized tabs.

## Handoff Status

Use this file as the fresh-context handoff source.

- `Done`: shipped and not currently a second-pass priority.
- `Partial`: the first-pass foundation shipped, but there is still meaningful second-pass work.
- `Next`: the best active second-pass work for a new agent to pick up.
- `Deferred`: intentionally not in second pass because the current embedded-player architecture makes it expensive or unreliable.

### Current state summary

- `Done`: top-level dashboard split into `Overview`, `Playback`, `Queue`, `Requests`, `Settings`, and `Library`
- `Done`: live queue management from the dashboard
- `Done`: queue persistence, stopped-track restore, and playback history
- `Done`: configurable request policy and configurable chat commands
- `Done`: expanded chat commands for queue, position, remove-own-request, open/close requests, and clear queue
- `Done`: library sorting, bulk actions, metadata refresh, title editing, and selected export
- `Done`: request safety controls for search safety, provider allowlists, blocked users/phrases, blocked sources, max duration, and live-stream blocking
- `Done`: diagnostics export and recent admin activity log
- `Done`: packaged Windows `Start with Windows` toggle
- `Partial`: playback polish is limited to restart tools, saved GUI volume, and startup-timeout tuning

## Second Pass Focus

1. `Next` Build library health review tooling.
   - Detect broken/unavailable tracks.
   - Track repeated playback failures.
   - Surface a repair/review queue in `Library`.
2. `Next` Add playlist-import previews.
   - Dry-run CSV import summary before apply.
   - Duplicate preview before append/replace.
3. `Next` Harden shared source/domain validation beyond the shipped request-policy controls.
   - Keep blocked URL domains aligned across chat, dashboard adds, and direct links.
   - Optional stricter source validation for embeds and manual queue flows.
4. `Next` Improve failure surfacing.
   - Make unavailable-track and queue-restore failures visible in the dashboard.
   - Carry more actionable detail into diagnostics exports and repair flows.
5. `Deferred` Do an architecture review before any deeper playback polish.
   - Current embedded YouTube/SoundCloud approach is fine for moderation and queueing.
   - It is not a clean base for true normalization or reliable crossfade.

## Planning Principles

- Keep the queue and playback state predictable first.
- Add moderation and safety controls before opening more powerful request flows.
- Prefer incremental API additions over rewrites.
- Preserve the current desktop-first workflow and OBS overlay compatibility.
- Keep settings migrations explicit and test-backed.
- Prefer repair/review workflows over broad new feature surface area in pass two.

## Proposed Main Tab Split

Status: `Done`

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

Status: `Done`

### User-facing goals

- Let mods and the streamer manage the queue directly from the dashboard.
- Keep the queue, stopped track, and recent history across restarts.
- Expose enough state for users to understand what is playing, queued, stopped, and recently played.

### Features

- Queue item actions:
  - `Done` remove specific queued track
  - `Done` move queued track to top
  - `Done` move up/down
  - `Done` clear full queue
  - `Done` restart stopped track
- Queue metadata:
  - `Done` requester name
  - `Done` provider badge
  - `Done` saved/not-saved badge
  - `Not done` added-at timestamp
- Playback history:
  - `Done` recent played list
  - `Done` status markers such as ended, skipped, deleted, errored
- Persistence:
  - `Done` persist `queue`, `stoppedTrack`, `history`, and admin activity
  - `Done` restore persisted state on startup

### Server and data changes

- `Done` runtime state store beside `settings.json` and `playlist.csv`
- `Done` explicit queue mutation methods in `PlayerController`
- `Done` persist after queue mutation and playback transition
- `Done` restore state before `ensurePlayback()` runs on boot
- `Done` startup rule: restore queue and stopped track, but do not auto-resume the interrupted track

### API work

- `Done` `GET /api/queue`
- `Done` `DELETE /api/queue/:trackId`
- `Done` `POST /api/queue/:trackId/promote`
- `Done` `POST /api/queue/:trackId/move`
- `Done` `POST /api/queue/clear`
- `Done` `GET /api/history`
- `Done` `POST /api/queue` kept as the add endpoint

### Dashboard work

- `Done` dedicated `Queue` tab
- `Done` moved full queue out of `Overview`
- `Done` kept `Overview` to preview + quick actions
- `Done` immediate UI feedback for queue mutations

### Tests

- `Done` `player-controller` tests for reorder, remove, clear, promote, and restore behavior
- `Done` `app-server` tests for queue endpoints
- `Done` migration/loading tests for persisted runtime state

## Phase 2: Request Guardrails And Moderation Policy

Priority: highest

Status: `Done`

Phase 2 is shipped. Any later roadmap items that mention request validation are follow-up hardening work, not unfinished Phase 2 scope.

### User-facing goals

- Give streamers control over who can request songs and under what limits.
- Prevent queue abuse before it becomes an operational problem.

### Features

- Request availability:
  - `Done` global requests on/off
  - `Done` mod-only mode through access levels
  - `Done` subscriber/VIP/broadcaster gating from Twitch tags
- Limits:
  - `Done` per-user queued track cap
  - `Done` per-user cooldown
  - `Done` global queue length cap
  - `Done` max track duration
  - optional min account age is out of scope unless Twitch APIs make it cheap
- Moderation lists:
  - `Done` blocked users
  - `Done` blocked phrases
  - `Done` blocked channels/accounts
  - `Done` blocked domains for direct links
  - `Done` allowed providers toggle
- Duplicate policy:
  - `Done` current duplicate detection
  - `Done` configurable duplicate window for recent history

### Server and data changes

- `Done` settings schema uses `requestPolicy`
- `Done` validate limits centrally before queue insertion
- `Done` resolve enough metadata to enforce duration and source rules for chat requests

### Bot and dashboard behavior

- `Done` denial replies are short and specific
- `Done` request-policy status is surfaced in `Requests` and `Overview`
- `Done` request status pill exists

### Tests

- `Done` command acceptance and rejection cases
- `Done` per-user cap and cooldown tests
- `Done` duration and provider restriction tests

## Phase 3: Configurable Chat Commands

Priority: highest

Status: `Done`

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

- `Done` `Requests` tab section for command configuration
- `Done` current trigger, aliases, enabled state, and permission level
- `Not done` reset-to-defaults action for commands only

### Tests

- `Done` command parsing with renamed triggers
- `Done` alias matching
- `Done` permission enforcement after rename
- `Done` settings validation for collisions

## Phase 4: Viewer And Moderator Command Expansion

Priority: high

Status: `Done`

### User-facing goals

- Cover the common song-request workflows users expect in chat.

### New commands to add

- `Done` queue display
- `Done` requester queue position
- `Done` remove own queued song
- `Done` open requests
- `Done` close requests
- `Done` clear queue
- maybe voteskip later, but only after request guardrails are stable

### Design notes

- Avoid dumping the full queue in one chat reply. Return a concise summary plus position.
- `remove own request` should remove the earliest queued track for that requester by default.
- Open/close commands should be limited to configured moderator roles.
- Voteskip should be explicitly deferred unless there is a clear policy for vote thresholds and anti-abuse controls.

## Phase 5: Playlist And Library Upgrades

Priority: high

Status: `Next`

### User-facing goals

- Make the fallback library manageable once it grows beyond a small CSV.

### Features

- Sorting:
  - `Done` title
  - `Done` provider
  - `Done` recently added
- Bulk actions:
  - `Done` multi-select delete
  - `Done` export selected
  - `Done` move selected to queue
- Metadata actions:
  - `Done` repair/refresh title
  - `Done` edit title
  - `Done` inspect provider and key
- Import improvements:
  - `Not done` dry-run summary before replace
  - `Not done` duplicate preview
  - import YouTube playlist URLs if feasible
  - import SoundCloud sets if feasible
- Health review:
  - `Not done` detect broken or unavailable items
  - `Not done` mark items with repeated playback failures

### Data and API changes

- `Not done` storage migration away from CSV-only semantics
- `Current approach` CSV remains the source of truth and export stays backward-compatible

### Dashboard work

- `Done` `Library` as its own tab
- `Done` search, sort controls, and bulk action toolbar
- `Done` import/export kept visible and separate from destructive bulk actions

### Second-pass focus

- `Next` detect unavailable tracks and repeated playback failures without breaking CSV import/export compatibility
- `Next` add a `Library` review queue for repair, retry, and cleanup workflows
- `Next` add import dry runs that preview duplicates, invalid rows, and replace-vs-append impact before commit

## Phase 6: Content Safety Controls

Priority: high

Status: `Partial`

### User-facing goals

- Reduce the chance of bad requests getting through.

### Features

- Search safety:
  - `Done` configurable YouTube `safeSearch`
  - `Done` optional search disable while still allowing direct URLs
- Source safety:
  - `Done` blocked YouTube channel ids
  - `Done` blocked SoundCloud users
  - `Done` provider allowlist
  - `Done` blocked direct-link domains for URL requests
- Query safety:
  - `Done` blocked keywords/phrases
  - blocked regex patterns only if the UI stays simple
- Request acceptance policy:
  - `Done` reject live streams
  - `Done` reject tracks over max duration
  - optionally reject tracks without embeddable metadata when detectable

### Design notes

- Keep the first version simple and explicit.
- Prefer a few predictable controls over a large moderation DSL.
- Put these controls in the `Requests` tab, not in a generic settings dump.

### Second-pass focus

- `Next` centralize stricter direct-link validation so embeds, chat requests, and manual queue flows share the same checks
- `Next` keep the safety model explicit instead of expanding into regex-heavy moderation rules

## Phase 7: Audio And Playback Polish

Priority: medium

Status: `Deferred pending architecture review`

### User-facing goals

- Make playback feel less abrupt and less inconsistent between sources.

### Features

- `Not done` fade in/fade out on track transitions
- `Not done` optional default volume per provider
- `Done` manual track restart
- `Done` remember last GUI player volume and expose it clearly
- `Done, practical equivalent` configurable embedded-player startup timeout for stuck loads

### Deferred unless architecture changes

- true loudness normalization
- reliable crossfade between providers
- per-track gain normalization

These are harder with embedded YouTube and SoundCloud players and should not block the higher-value moderation and queue work.

### Second-pass focus

- `Deferred` do not start fades, normalization, or cross-provider polish until the playback architecture is reviewed
- `Deferred` if audio work becomes important, decide first whether embedded players remain the long-term playback model

## Phase 8: Diagnostics And Admin Quality Of Life

Priority: medium

Status: `Next`

### Features

- Admin activity log in dashboard:
  - `Done` who skipped
  - `Done` who deleted
  - `Done` who closed requests
- Better surfaced error states:
  - `Done` invalid token
  - `Partial` unavailable track reporting
  - `Partial` queue restore failures
- `Done` one-click export of logs/settings/runtime state for debugging

### Second-pass focus

- `Next` surface unavailable-track details directly in dashboard and library repair flows
- `Next` make queue-restore failures actionable instead of leaving them as low-context diagnostics
- `Next` include failure reasons and review metadata in diagnostics exports where practical

## Recommended Delivery Order

Status: `Active second-pass order`

1. Library health review and repair queue
2. CSV import dry-run and duplicate preview
3. Shared URL validation hardening
4. Better unavailable-track and queue-restore diagnostics
5. Optional command/settings polish such as command reset-to-defaults
6. Playback architecture review before any deeper audio work

## Suggested Milestones

### Milestone A: Library Health Review

Status: `Next`

- repeated playback failures are tracked per saved item
- unavailable or broken tracks are visible in a repair/review view
- moderators can retry, inspect, or remove flagged tracks quickly

### Milestone B: Import Safety

Status: `Next`

- replace and append imports can run as a dry preview first
- duplicate rows are summarized before commit
- invalid rows are reported with actionable reasons

### Milestone C: Source Validation Hardening

Status: `Partial`

- `Done` blocked direct-link domains can be configured from the dashboard
- `Next` URL parsing and validation happen in one shared path
- `Next` denial replies stay short but explain whether the domain, provider, or metadata rule failed

### Milestone D: Failure Visibility

Status: `Next`

- unavailable-track details are visible outside exported diagnostics
- queue-restore failures surface enough context for recovery
- diagnostics exports include the data needed to explain recent failures

### Milestone E: Playback Architecture Decision

Status: `Deferred`

- decide whether embedded players remain the long-term playback model
- only schedule fade, normalization, or crossfade work if that review says the architecture can support it cleanly

## Implementation Notes By File

Status: keep this section as a quick orientation map for the next agent doing second-pass work

### `src/player-controller.js`

- Track repeated playback failures and repair metadata here if the state needs playback-context awareness.
- Keep playback transition logic and failure classification centralized here.

### `src/app-server.js`

- Add library health, import preview, and direct-link safety endpoints.
- Keep the dashboard API thin and focused on explicit actions.

### `src/twitch-bot.js`

- Reuse centralized URL/domain validation before accepting direct-link requests.
- Keep denial replies short and specific when second-pass safety rules reject a request.

### `src/config.js`

- Extend typed settings carefully for blocked domains, repair preferences, and any second-pass safety toggles.
- Keep defaults and migrations explicit.

### `src/playlist-repository.js`

- Store any supplemental library review metadata without breaking CSV as the user-facing import/export format.
- Keep export backward-compatible even if repair metadata lives beside the CSV.

### `src/providers.js`

- Centralize URL parsing, direct-link domain extraction, and provider-specific validation here when possible.
- Keep provider detection predictable so request-policy checks do not drift between chat and dashboard flows.

### `public/dashboard.js`

- Add library repair/review surfaces and import-preview workflows without making the `Library` tab harder to scan.
- Surface second-pass diagnostics where moderators can act on them immediately.

## Non-Goals Still Out Of Scope

Status: still valid for second pass

- Spotify playback support
- web-hosted multi-user remote dashboard
- advanced recommendation engine
- heavy role synchronization outside the Twitch tags already available
- perfect audio normalization across providers

## Definition Of Done For The Second Pass

The second pass is complete when:

- saved-library items can be reviewed for repeated playback failures and unavailable sources
- imports can be previewed before append or replace, including duplicate and invalid-row summaries
- direct-link requests can be blocked by domain and run through the same validation path everywhere
- moderators can see actionable unavailable-track and queue-restore failures in the dashboard or diagnostics export
- second-pass settings/data migrations stay explicit, restart-safe, and test-covered

### Explicitly deferred from the second-pass definition of done

- fades, normalization, and cross-provider audio polish without a prior architecture review
- major new provider support
- large multi-user or web-hosted dashboard expansion
