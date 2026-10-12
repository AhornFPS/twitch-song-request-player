const socket = typeof window.io === "function" ? window.io() : null;
const body = document.body;
const root = document.getElementById("dashboard-root");
const updateModal = document.getElementById("update-modal");
const updateVersionText = document.getElementById("update-version-text");
const updateReleaseNotes = document.getElementById("update-release-notes");
const updateProgressContainer = document.getElementById("update-progress-container");
const updateProgressFill = document.getElementById("update-progress-fill");
const updateProgressText = document.getElementById("update-progress-text");
const updateErrorText = document.getElementById("update-error-text");
const updateActionBtn = document.getElementById("update-action-btn");
const updateSkipBtn = document.getElementById("update-skip-btn");
let isSavingSettings = false;
let isHydratingForm = false;
let savedSettingsDraft = null;
let settingsSaveError = "";
let settingsSaveNotice = "";
let youtubeApiCheckController = null;
let availableThemes = [];
let lastSavedTheme = "aurora";
let lastSavedOverlayScalePercent = 100;
let lastTwitchAuthState = "";
let chatSuppressedCategories = [];
let playbackSuppressedCategories = [];
let playlistPage = 1;
let playlistTotalPages = 1;
let playlistQuery = "";
let playlistSortBy = "recent";
let playlistSearchDebounceTimer = null;
let playlistImportMode = "append";
let playlistResetPending = false;
let youtubePlaylistImportPending = false;
let playlistSelectedKeys = /* @__PURE__ */ new Set();
let settingsPayload = null;
let playbackState = null;
let playlistPayload = null;
let playlistReviewPayload = null;
let activeTab = "overview";
let isQueueSubmitting = false;
let isOverviewSearchPending = false;
let overviewSearchResults = [];
let overviewProgressTimer = null;
let overviewProgressTrackId = "";
let overviewProgressElapsedSeconds = 0;
let overviewProgressDurationSeconds = 0;
let overviewProgressLastSyncAt = 0;
let overviewProgressIsRunning = false;
let isPlaybackCommandPending = false;
let isGuiPlayerSaving = false;
let guiPlayerVolume = 100;
let guiPlayerVolumeSaveTimer = null;
let isGuiPlayerVolumeSaving = false;
let isManualUpdateCheckPending = false;
let queueActionTrackId = "";
let requestPolicyDraft = null;
let requestPolicyAutosaveTimer = null;
let isRequestPolicyAutosaveSaving = false;
let hasPendingRequestPolicyAutosave = false;
let autoDjStatus = null;
let isAutoDjActivationPending = false;
let autoDjStatusTimer = null;
let saveFeedbackTimer = null;
function el(id) {
  return document.getElementById(id);
}
function setText(id, value) {
  const target = el(id);
  if (target) {
    target.textContent = value;
  }
}
function setValue(id, value) {
  const target = el(id);
  if (target) {
    target.value = value;
  }
}
function htmlEscape(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
const DASHBOARD_TABS = [
  { id: "overview", label: "Now Playing" },
  { id: "queue", label: "Queue & History" },
  { id: "requests", label: "Requests & Chat" },
  { id: "library", label: "Library" },
  { id: "autodj", label: "AutoDJ" },
  { id: "settings", label: "Settings" }
];
function renderDashboard() {
  body.dataset.dashboardLayout = "atlas";
  root.innerHTML = `
    <div class="app-shell atlas-shell">
      <header class="shell-header">
        <div class="shell-header__bar">
          <div class="brand">
            <span class="brand__mark" aria-hidden="true">\u266A</span>
            <h1 class="brand__title">HornGaming <span>Music Control Center</span></h1>
            <span id="app-version-badge" class="status-pill status-pill--idle">Version Loading</span>
          </div>
          <div class="status-strip" role="group" aria-label="Live status">
            <span id="twitch-status-pill" class="status-pill status-pill--idle">Waiting</span>
            <span id="twitch-category-pill" class="status-pill status-pill--idle">Category unknown</span>
            <span id="requests-status-pill" class="status-pill status-pill--idle">Requests loading</span>
            <span id="server-port-pill" class="status-pill status-pill--accent">Port 3000</span>
          </div>
        </div>
        <nav class="atlas-tabs" role="tablist" aria-label="Dashboard sections">
          ${DASHBOARD_TABS.map(({ id, label }) => `
            <button id="tab-button-${id}" class="tab-button" type="button" role="tab" data-tab="${id}" aria-controls="tab-${id}" aria-selected="false" tabindex="-1">${label}</button>
          `).join("")}
        </nav>
      </header>

      <p id="save-feedback" class="feedback toast" role="status" aria-live="polite"></p>

      <aside class="settings-save-bar" aria-label="Save settings">
        <div class="settings-save-bar__copy" role="status" aria-live="polite" aria-atomic="true">
          <strong id="settings-save-status">Loading settings\u2026</strong>
          <span id="settings-save-detail">Changes that need saving will appear here.</span>
        </div>
        <button id="save-button" class="primary-button" type="button" disabled>Save changes</button>
      </aside>

      <section id="tab-overview" class="atlas-view" role="tabpanel" aria-labelledby="tab-button-overview">
        <div class="atlas-grid atlas-grid--overview">
          <div class="stack-layout">
            <section class="panel now-playing" aria-labelledby="now-playing-heading">
              <div class="panel__header">
                <h2 id="now-playing-heading" class="panel__eyebrow">Now playing</h2>
                <span id="playback-state-pill" class="status-pill status-pill--idle">Idle</span>
              </div>
              <p id="current-track-title" class="now-playing__title">Waiting for a track</p>
              <p id="current-track-meta" class="now-playing__meta">Queue is empty. Fallback playlist will play automatically.</p>
              <div id="overview-progress" class="playback-progress" hidden>
                <div class="playback-progress__track" aria-hidden="true">
                  <div id="overview-progress-fill" class="playback-progress__fill"></div>
                </div>
                <div class="playback-progress__labels">
                  <span id="overview-progress-elapsed">0:00</span>
                  <span id="overview-progress-duration">0:00</span>
                </div>
              </div>
              <div class="playback-controls" role="group" aria-label="Playback controls">
                <button id="overview-play-pause" class="primary-button" type="button">Play</button>
                <button id="overview-stop" class="secondary-button" type="button">Stop</button>
                <button id="overview-next" class="secondary-button" type="button">Next track</button>
                <button id="overview-save" class="secondary-button" type="button" title="Save the current track to the fallback library">Save</button>
                <button id="playback-restart-stopped" class="ghost-button" type="button">Restart stopped track</button>
              </div>
              <p id="overview-playback-owner" class="field__hint" hidden></p>
            </section>

            <section class="panel" aria-labelledby="add-to-queue-heading">
              <h2 id="add-to-queue-heading" class="panel__title">Add to queue</h2>
              <form id="overview-queue-form" class="inline-form">
                <input id="overview-queue-input" class="control-input" type="text" aria-label="Track link or search text" aria-describedby="overview-queue-hint" placeholder="Paste a YouTube, SoundCloud, Spotify, or Suno link \u2014 or type a search" autocomplete="off" />
                <button id="overview-queue-button" class="primary-button" type="submit">Add</button>
                <button id="overview-search-button" class="secondary-button" type="button">Search</button>
              </form>
              <p id="overview-queue-hint" class="field__hint">Links are queued right away. Use Search to pick from results first.</p>
              <p id="overview-feedback" class="feedback" role="status" aria-live="polite"></p>
              <div id="overview-search-results" class="history-list" aria-label="Search results" hidden></div>
            </section>
          </div>

          <div class="stack-layout">
            <section class="panel" aria-labelledby="up-next-heading">
              <div class="panel__header">
                <h2 id="up-next-heading" class="panel__title">Up next</h2>
                <button class="link-button" type="button" data-tab-link="queue">Manage queue</button>
              </div>
              <ol id="queue-preview" class="queue-preview"></ol>
            </section>

            <section class="panel" aria-labelledby="desktop-player-heading">
              <div class="panel__header">
                <h2 id="desktop-player-heading" class="panel__title">Desktop player</h2>
                <button id="overview-gui-player-toggle" class="secondary-button" type="button">Activate GUI player</button>
              </div>
              <p id="overview-gui-player-status" class="field__hint">Inactive. Activate it to play inside the desktop app without OBS.</p>
              <label class="range-field">
                <span class="field__label">Volume</span>
                <input id="overview-gui-player-volume" class="range-field__input" type="range" min="0" max="100" step="1" value="100" />
                <span id="overview-gui-player-volume-value" class="range-field__value">100%</span>
              </label>
              <div id="overview-player-frame-wrap" class="overview-player-frame-wrap" hidden>
                <iframe
                  id="overview-player-frame"
                  class="overview-player-frame"
                  title="Embedded desktop player"
                  allow="autoplay"
                ></iframe>
              </div>
              <p class="field__hint">Player activation and volume save automatically.</p>
            </section>
          </div>
        </div>
      </section>

      <section id="tab-queue" class="atlas-view" role="tabpanel" aria-labelledby="tab-button-queue" hidden>
        <div class="stack-layout">
          <section class="panel" aria-labelledby="queue-heading">
            <div class="panel__header">
              <h2 id="queue-heading" class="panel__title">Request queue</h2>
              <button id="queue-clear-button" class="ghost-button ghost-button--danger" type="button">Clear queue</button>
            </div>
            <p id="queue-feedback" class="feedback" role="status" aria-live="polite"></p>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th scope="col" class="data-table__index">#</th>
                    <th scope="col">Title</th>
                    <th scope="col">Requester</th>
                    <th scope="col">Source</th>
                    <th scope="col" class="data-table__actions">Actions</th>
                  </tr>
                </thead>
                <tbody id="queue-table-body"></tbody>
              </table>
              <div id="queue-empty-state" class="empty-state" hidden>No queued requests yet.</div>
            </div>
          </section>

          <div class="atlas-grid atlas-grid--halves">
            <section class="panel" aria-labelledby="history-heading">
              <h2 id="history-heading" class="panel__title">Recent playback</h2>
              <div id="history-list" class="history-list"></div>
            </section>
            <section class="panel" aria-labelledby="admin-events-heading">
              <h2 id="admin-events-heading" class="panel__title">Control activity</h2>
              <div id="admin-event-list" class="history-list"></div>
            </section>
          </div>
        </div>
      </section>

      <section id="tab-requests" class="atlas-view" role="tabpanel" aria-labelledby="tab-button-requests" hidden>
        <p id="requests-save-note" class="panel-note">Request controls and chat commands apply with Save changes below.</p>
        <div class="stack-layout">
          <section class="panel" aria-labelledby="requests-access-heading">
            <div class="panel__header">
              <h2 id="requests-access-heading" class="panel__title">Song requests</h2>
              <div class="button-row">
                <span id="requests-tab-pill" class="status-pill status-pill--idle">Requests loading</span>
                <button
                  id="requests-autosave-button"
                  class="ghost-button request-autosave-button"
                  type="button"
                  aria-pressed="false"
                >
                  Autosave Off
                </button>
              </div>
            </div>
            <div class="form-grid form-grid--3">
              <label class="toggle-card field--full" for="requests-enabled-toggle">
                <span class="toggle-card__copy">
                  <span class="toggle-card__title">Accept song requests</span>
                  <span id="requests-status-copy" class="toggle-card__body">Viewer requests can be queued from chat.</span>
                </span>
                <input id="requests-enabled-toggle" class="switch" type="checkbox" role="switch" />
              </label>
              <label class="toggle-card field--full" for="requests-auto-save-completed-toggle">
                <span class="toggle-card__copy">
                  <span class="toggle-card__title">Automatically save completed requests</span>
                  <span class="toggle-card__body">Add requested tracks to the fallback library after they finish naturally. Skipped or failed requests are not added.</span>
                </span>
                <input id="requests-auto-save-completed-toggle" class="switch" type="checkbox" role="switch" />
              </label>
              <label class="field">
                <span class="field__label">Who can request</span>
                <select id="requests-access-level" class="control-input" aria-describedby="requests-access-level-hint">
                  <option value="everyone">Everyone</option>
                  <option value="subscriber">Subscribers and above</option>
                  <option value="vip">VIPs and above</option>
                  <option value="moderator">Moderators only</option>
                  <option value="broadcaster">Broadcaster only</option>
                </select>
                <span id="requests-access-level-hint" class="field__hint">Moderators and the broadcaster always bypass request caps.</span>
              </label>
              <label class="field">
                <span class="field__label">YouTube safe search</span>
                <select id="requests-safe-search" class="control-input" aria-describedby="requests-safe-search-hint">
                  <option value="none">None</option>
                  <option value="moderate">Moderate</option>
                  <option value="strict">Strict</option>
                </select>
                <span id="requests-safe-search-hint" class="field__hint">Applies to chat search requests. Direct links are still allowed.</span>
              </label>
              <fieldset class="field provider-fieldset">
                <legend class="field__label">Allowed providers</legend>
                <div class="chip-checks">
                  <label class="chip-check"><input id="requests-provider-youtube" type="checkbox" /><span>YouTube</span></label>
                  <label class="chip-check"><input id="requests-provider-soundcloud" type="checkbox" /><span>SoundCloud</span></label>
                  <label class="chip-check"><input id="requests-provider-spotify" type="checkbox" /><span>Spotify</span></label>
                  <label class="chip-check"><input id="requests-provider-suno" type="checkbox" /><span>Suno</span></label>
                </div>
              </fieldset>
              <label class="toggle-card" for="requests-allow-search-toggle">
                <span class="toggle-card__copy">
                  <span class="toggle-card__title">Allow text-search requests</span>
                  <span class="toggle-card__body">When off, chat requests must be direct links.</span>
                </span>
                <input id="requests-allow-search-toggle" class="switch" type="checkbox" role="switch" />
              </label>
              <label class="toggle-card" for="requests-reject-live-toggle">
                <span class="toggle-card__copy">
                  <span class="toggle-card__title">Block live streams</span>
                  <span class="toggle-card__body">Reject live or upcoming YouTube streams.</span>
                </span>
                <input id="requests-reject-live-toggle" class="switch" type="checkbox" role="switch" />
              </label>
            </div>
          </section>

          <section class="panel" aria-labelledby="requests-limits-heading">
            <h2 id="requests-limits-heading" class="panel__title">Limits</h2>
            <p class="panel-note">Set any limit to 0 to turn it off.</p>
            <div class="form-grid form-grid--3">
              <label class="field">
                <span class="field__label">Max queued requests</span>
                <input id="requests-max-queue-length" class="control-input" type="number" min="0" step="1" />
              </label>
              <label class="field">
                <span class="field__label">Max active requests per user</span>
                <input id="requests-max-per-user" class="control-input" type="number" min="0" step="1" aria-describedby="requests-max-per-user-hint" />
                <span id="requests-max-per-user-hint" class="field__hint">Counts queued, playing, and stopped tracks.</span>
              </label>
              <label class="field">
                <span class="field__label">Per-user cooldown (seconds)</span>
                <input id="requests-cooldown-seconds" class="control-input" type="number" min="0" step="1" aria-describedby="requests-cooldown-hint" />
                <span id="requests-cooldown-hint" class="field__hint">Time between successful requests from one viewer.</span>
              </label>
              <label class="field">
                <span class="field__label">Max track duration (seconds)</span>
                <input id="requests-max-duration-seconds" class="control-input" type="number" min="0" step="1" aria-describedby="requests-max-duration-hint" />
                <span id="requests-max-duration-hint" class="field__hint">Checked when the provider reports a track length.</span>
              </label>
              <label class="field">
                <span class="field__label">Recent duplicate window (tracks)</span>
                <input id="requests-duplicate-history-count" class="control-input" type="number" min="0" step="1" aria-describedby="requests-duplicate-hint" />
                <span id="requests-duplicate-hint" class="field__hint">Rejects tracks found in this many recent history entries.</span>
              </label>
            </div>
          </section>

          <section class="panel" aria-labelledby="requests-blocklists-heading">
            <h2 id="requests-blocklists-heading" class="panel__title">Block lists</h2>
            <p class="panel-note">One entry per line. Matching ignores upper and lower case.</p>
            <div class="form-grid form-grid--3">
              <label class="field">
                <span class="field__label">Blocked usernames</span>
                <textarea id="requests-blocked-users" class="control-input control-input--multiline" rows="4" placeholder="viewerone&#10;viewertwo"></textarea>
              </label>
              <label class="field">
                <span class="field__label">Blocked phrases</span>
                <textarea id="requests-blocked-phrases" class="control-input control-input--multiline" rows="4" placeholder="artist name&#10;banned phrase" aria-describedby="requests-blocked-phrases-hint"></textarea>
                <span id="requests-blocked-phrases-hint" class="field__hint">Requests containing a phrase are rejected.</span>
              </label>
              <label class="field">
                <span class="field__label">Blocked direct-link domains</span>
                <textarea id="requests-blocked-domains" class="control-input control-input--multiline" rows="4" placeholder="example.com" aria-describedby="requests-blocked-domains-hint"></textarea>
                <span id="requests-blocked-domains-hint" class="field__hint">Hostnames; subdomains are blocked too.</span>
              </label>
              <label class="field">
                <span class="field__label">Blocked YouTube channels</span>
                <textarea id="requests-blocked-youtube-channels" class="control-input control-input--multiline" rows="4" placeholder="UC1234567890abcdef&#10;@channelhandle" aria-describedby="requests-blocked-youtube-hint"></textarea>
                <span id="requests-blocked-youtube-hint" class="field__hint">Channel ID, handle, custom path, or channel URL.</span>
              </label>
              <label class="field">
                <span class="field__label">Blocked SoundCloud users</span>
                <textarea id="requests-blocked-soundcloud-users" class="control-input control-input--multiline" rows="4" placeholder="artistname&#10;https://soundcloud.com/artistname" aria-describedby="requests-blocked-soundcloud-hint"></textarea>
                <span id="requests-blocked-soundcloud-hint" class="field__hint">Profile URL, username slug, or author name.</span>
              </label>
            </div>
            <p id="requests-feedback" class="feedback" role="status" aria-live="polite"></p>
          </section>

          <section class="panel" aria-labelledby="chat-bot-heading">
            <h2 id="chat-bot-heading" class="panel__title">Chat bot</h2>
            <div class="form-grid form-grid--3">
              <label class="field">
                <span class="field__label">Announce now playing</span>
                <select id="twitch-track-announcement-mode" class="control-input" aria-describedby="track-announcement-hint">
                  <option value="all">All tracks</option>
                  <option value="requests">Song requests only</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <p id="track-announcement-hint" class="field__hint form-grid__span-2">Which tracks the bot announces in chat. Song requests only skips playlist fallbacks, radio, and automatic AutoDJ tracks. Current-song commands and request replies always work.</p>
            </div>
            <h3 class="panel__subtitle">Chat commands</h3>
            <div class="table-wrap">
              <table class="data-table command-table">
                <thead>
                  <tr>
                    <th scope="col">Command</th>
                    <th scope="col">Primary trigger</th>
                    <th scope="col">Aliases</th>
                    <th scope="col">Permission</th>
                    <th scope="col">Enabled</th>
                  </tr>
                </thead>
                <tbody id="chat-commands-body"></tbody>
              </table>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-library" class="atlas-view" role="tabpanel" aria-labelledby="tab-button-library" hidden>
        <div class="stack-layout">
          <section class="panel" aria-labelledby="library-heading">
            <div class="panel__header">
              <div>
                <h2 id="library-heading" class="panel__title">Fallback library</h2>
                <p class="panel-note">Plays automatically when the request queue is empty.</p>
              </div>
              <div class="button-row">
                <button id="playlist-import-append" class="ghost-button" type="button">Import CSV</button>
                <button id="playlist-import-replace" class="ghost-button" type="button">Replace from CSV</button>
                <button id="playlist-export-button" class="ghost-button" type="button">Export CSV</button>
                <button id="playlist-fresh-button" class="ghost-button ghost-button--danger" type="button">Start fresh library</button>
              </div>
            </div>
            <div class="form-grid form-grid--halves">
              <form id="playlist-add-form" class="inline-form">
                <input id="playlist-add-input" class="control-input" type="text" aria-label="Track link or search text to add to the library" placeholder="Add a track: link or search text" autocomplete="off" />
                <button id="playlist-add-button" class="primary-button" type="submit">Add to library</button>
              </form>
              <form id="playlist-youtube-form" class="inline-form">
                <input id="playlist-youtube-input" class="control-input" type="url" aria-label="YouTube playlist URL" aria-describedby="playlist-youtube-help" placeholder="https://www.youtube.com/playlist?list=..." autocomplete="off" required />
                <button id="playlist-youtube-button" class="secondary-button" type="submit">Import playlist</button>
              </form>
            </div>
            <p id="playlist-youtube-help" class="field__hint">Imports a public or unlisted YouTube playlist, skipping duplicates and unavailable videos. Requires a YouTube API key in Settings.</p>
            <p id="playlist-youtube-feedback" class="feedback" role="status" aria-live="polite"></p>
            <p id="playlist-feedback" class="feedback" role="status" aria-live="polite"></p>
            <input id="playlist-import-file" type="file" accept=".csv,text/csv" hidden />

            <div class="table-toolbar">
              <div class="table-toolbar__filters">
                <label class="field field--inline">
                  <span class="field__label">Search</span>
                  <input id="playlist-search-input" class="control-input" type="search" placeholder="Title, link, or provider" autocomplete="off" />
                </label>
                <label class="field field--inline">
                  <span class="field__label">Sort</span>
                  <select id="playlist-sort-select" class="control-input">
                    <option value="recent">Recently added</option>
                    <option value="title">Title</option>
                    <option value="provider">Provider</option>
                  </select>
                </label>
                <span class="library-summary" aria-live="polite"><span id="playlist-count">0 tracks</span></span>
              </div>
              <div class="button-row" role="group" aria-label="Selected tracks">
                <button id="playlist-bulk-queue-button" class="secondary-button" type="button">Queue selected</button>
                <button id="playlist-export-selected-button" class="ghost-button" type="button">Export selected</button>
                <button id="playlist-bulk-delete-button" class="ghost-button ghost-button--danger" type="button">Delete selected</button>
              </div>
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th scope="col" class="data-table__checkbox">
                      <input id="playlist-select-page" type="checkbox" aria-label="Select all tracks on this page" />
                    </th>
                    <th scope="col">Title</th>
                    <th scope="col">Source</th>
                    <th scope="col">Link</th>
                    <th scope="col" class="data-table__actions">Actions</th>
                  </tr>
                </thead>
                <tbody id="playlist-table-body"></tbody>
              </table>
              <div id="playlist-empty-state" class="empty-state" hidden>No playlist tracks matched this search.</div>
            </div>
            <nav class="pagination-row" aria-label="Library pages">
              <button id="playlist-prev-page" class="ghost-button" type="button">Previous</button>
              <span id="playlist-page-info">Page 1 of 1</span>
              <button id="playlist-next-page" class="ghost-button" type="button">Next</button>
            </nav>
          </section>

          <section class="panel" aria-labelledby="library-review-heading">
            <div class="panel__header">
              <div>
                <h2 id="library-review-heading" class="panel__title">Health review</h2>
                <p class="panel-note">Tracks that fail playback or metadata refreshes stay here until they recover or are removed.</p>
              </div>
              <div class="button-row">
                <span id="playlist-review-flagged-count" class="status-pill status-pill--warn">0 flagged</span>
                <span id="playlist-review-total-failures" class="status-pill status-pill--idle">0 failures</span>
              </div>
            </div>
            <div id="playlist-review-list" class="history-list"></div>
          </section>
        </div>
      </section>

      <section id="tab-autodj" class="atlas-view" role="tabpanel" aria-labelledby="tab-button-autodj" hidden>
        <div class="stack-layout">
          <section class="panel" aria-labelledby="autodj-heading">
            <div class="panel__header">
              <div>
                <p class="panel__eyebrow">Standalone service</p>
                <h2 id="autodj-heading" class="panel__title">AutoDJ</h2>
              </div>
              <div class="button-row">
                <span id="autodj-connection-pill" class="status-pill status-pill--idle">Unconfigured</span>
                <span id="autodj-activation-pill" class="status-pill status-pill--idle">Disabled</span>
              </div>
            </div>
            <p class="panel-note">AutoDJ handles local music, track selection, mixing, and browser output. This app only sends it authenticated control requests. Play normally on Now Playing pauses AutoDJ and keeps this connection saved.</p>
            <div class="button-row">
              <button id="autodj-activation" class="primary-button" type="button">Enable AutoDJ</button>
              <button id="autodj-mix-next" class="secondary-button" type="button">Mix Next</button>
              <a id="autodj-output-link" class="ghost-button" href="/autodj-output" target="_blank" rel="noopener noreferrer">Open browser output</a>
            </div>
            <p id="autodj-feedback" class="feedback" role="status" aria-live="polite"></p>
            <div id="autodj-pairing-requests" class="history-list"></div>
          </section>

          <div class="atlas-grid atlas-grid--halves">
            <section class="panel" aria-labelledby="autodj-now-heading">
              <h2 id="autodj-now-heading" class="panel__title">Now playing</h2>
              <p id="autodj-current-track" class="now-playing__title now-playing__title--small">No AutoDJ state received.</p>
              <p id="autodj-last-seen" class="now-playing__meta">Last seen: never</p>
              <p id="autodj-takeover" class="field__hint">Viewer-request takeover inactive.</p>
            </section>
            <section class="panel" aria-labelledby="autodj-upcoming-heading">
              <h2 id="autodj-upcoming-heading" class="panel__title">Upcoming</h2>
              <div id="autodj-upcoming" class="history-list"><p class="empty-state">No upcoming tracks reported.</p></div>
            </section>
          </div>

          <section class="panel" aria-labelledby="autodj-connection-heading">
            <div class="panel__header">
              <h2 id="autodj-connection-heading" class="panel__title">Connection</h2>
              <div class="button-row">
                <button id="autodj-discover" class="secondary-button" type="button">Find AutoDJ</button>
                <button id="autodj-refresh" class="ghost-button" type="button">Refresh status</button>
              </div>
            </div>
            <p class="panel-note">Applies with Save changes below, or when you resume AutoDJ.</p>
            <div class="form-grid form-grid--4">
              <label class="field form-grid__span-2">
                <span class="field__label">AutoDJ service URL</span>
                <input id="autodj-service-url" class="control-input" type="url" placeholder="http://127.0.0.1:3100" autocomplete="off" />
              </label>
              <label class="field form-grid__span-2">
                <span class="field__label">Browser output URL (optional override)</span>
                <input id="autodj-browser-output-url" class="control-input" type="url" autocomplete="off" />
              </label>
              <label class="field form-grid__span-2">
                <span class="field__label">Bearer token</span>
                <input id="autodj-service-token" class="control-input" type="password" autocomplete="off" />
              </label>
              <label class="field">
                <span class="field__label">Lease duration (seconds)</span>
                <input id="autodj-lease-seconds" class="control-input" type="number" min="15" max="300" step="1" />
              </label>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-settings" class="atlas-view" role="tabpanel" aria-labelledby="tab-button-settings" hidden>
        <div class="settings-layout">
          <nav class="settings-nav" aria-label="Settings sections">
            <a href="#settings-twitch">Twitch</a>
            <a href="#settings-youtube">YouTube</a>
            <a href="#settings-obs">Overlay &amp; OBS</a>
            <a href="#settings-playback">Playback</a>
            <a href="#settings-categories">Category rules</a>
            <a href="#settings-app">App</a>
          </nav>
          <form id="settings-form" class="stack-layout">
            <p class="panel-note">Changes here apply when you click Save changes below. Items marked \u201Csaves automatically\u201D apply right away.</p>

            <section id="settings-twitch" class="panel settings-section" aria-labelledby="settings-twitch-heading">
              <div class="panel__header">
                <h2 id="settings-twitch-heading" class="panel__title">Twitch</h2>
                <div class="button-row">
                  <button id="twitch-auth-start" class="primary-button" type="button">Connect bot with Twitch</button>
                  <button id="twitch-auth-cancel" class="ghost-button" type="button">Cancel</button>
                </div>
              </div>
              <p id="twitch-status-text" class="status-line">Waiting for configuration.</p>
              <p id="twitch-auth-status-text" class="panel-note">Use the bundled Twitch Client ID to start the in-app bot login flow.</p>
              <div id="twitch-auth-details" class="form-grid form-grid--halves" hidden>
                <div class="field">
                  <label class="field__label" for="twitch-auth-code">Activation code</label>
                  <div class="copy-row">
                    <input id="twitch-auth-code" class="control-input" type="text" readonly />
                    <button class="copy-row__button" type="button" data-copy-target="twitch-auth-code">Copy</button>
                  </div>
                </div>
                <div class="field">
                  <label class="field__label" for="twitch-auth-url">Verification page</label>
                  <div class="copy-row copy-row--triple">
                    <input id="twitch-auth-url" class="control-input" type="text" readonly />
                    <button class="copy-row__button" type="button" data-open-url-target="twitch-auth-url">Open</button>
                    <button class="copy-row__button" type="button" data-copy-target="twitch-auth-url">Copy</button>
                  </div>
                </div>
              </div>
              <h3 class="panel__subtitle">Manual credentials</h3>
              <div class="form-grid form-grid--halves">
                <label class="field">
                  <span class="field__label">Twitch channel</span>
                  <input id="twitchChannel" name="twitchChannel" class="control-input" type="text" autocomplete="off" aria-describedby="twitch-channel-hint" />
                  <span id="twitch-channel-hint" class="field__hint">Usually the streamer name without #.</span>
                </label>
                <label class="field">
                  <span class="field__label">Bot username</span>
                  <input id="twitchUsername" name="twitchUsername" class="control-input" type="text" autocomplete="off" aria-describedby="twitch-username-hint" />
                  <span id="twitch-username-hint" class="field__hint">The Twitch account that joins chat.</span>
                </label>
                <label class="field field--full">
                  <span class="field__label">Bot OAuth token</span>
                  <input id="twitchOauthToken" name="twitchOauthToken" class="control-input" type="password" autocomplete="off" aria-describedby="twitch-token-hint" />
                  <span id="twitch-token-hint" class="field__hint">Manual tokens keep the oauth: prefix and need chat scopes. <a class="field__link" href="https://dev.twitch.tv/docs/irc/authenticate-bot" target="_blank" rel="noopener noreferrer">How to get this token</a></span>
                </label>
                <label class="field">
                  <span class="field__label">Twitch Client ID</span>
                  <input id="twitchClientId" name="twitchClientId" class="control-input" type="text" autocomplete="off" aria-describedby="twitch-client-id-hint" />
                  <span id="twitch-client-id-hint" class="field__hint">Leave the bundled value unless you use your own Twitch app.</span>
                </label>
                <label class="field">
                  <span class="field__label">Twitch Client Secret</span>
                  <input id="twitchClientSecret" name="twitchClientSecret" class="control-input" type="password" autocomplete="off" aria-describedby="twitch-client-secret-hint" />
                  <span id="twitch-client-secret-hint" class="field__hint">Only needed for source-only Shared Chat messages.</span>
                </label>
                <label class="toggle-card field--full" for="twitch-shared-chat-source-only-toggle">
                  <span class="toggle-card__copy">
                    <span class="toggle-card__title">Source-only Shared Chat messages</span>
                    <span class="toggle-card__body">Bot replies stay in your channel during Shared Chat. Requires a Client Secret and updated bot login scopes.</span>
                  </span>
                  <input id="twitch-shared-chat-source-only-toggle" class="switch" type="checkbox" role="switch" />
                </label>
              </div>
            </section>

            <section id="settings-youtube" class="panel settings-section" aria-labelledby="settings-youtube-heading">
              <h2 id="settings-youtube-heading" class="panel__title">YouTube</h2>
              <div class="field">
                <label class="field__label" for="youtubeApiKey">YouTube API key</label>
                <div class="copy-row">
                  <input id="youtubeApiKey" name="youtubeApiKey" class="control-input" type="password" autocomplete="off" aria-describedby="youtube-api-help youtube-api-feedback" />
                  <button id="youtube-api-check" class="secondary-button" type="button">Check API key</button>
                </div>
                <span id="youtube-api-help" class="field__hint">Needed for text searches, Spotify matching, playlist imports, and metadata repair. Checking uses 1 quota unit and does not save; use Save changes to apply a new key.</span>
                <span class="field__hint"><a class="field__link" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener noreferrer">Enable YouTube Data API v3</a> \xB7 <a class="field__link" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Manage API keys</a></span>
                <p id="youtube-api-feedback" class="feedback" role="status" aria-live="polite">Not checked. Click Check API key to test access.</p>
              </div>
            </section>

            <section id="settings-obs" class="panel settings-section" aria-labelledby="settings-obs-heading">
              <h2 id="settings-obs-heading" class="panel__title">Overlay &amp; OBS</h2>
              <div class="form-grid form-grid--halves">
                <div class="field">
                  <label class="field__label" for="overlay-url">Overlay URL (OBS Browser Source)</label>
                  <div class="copy-row">
                    <input id="overlay-url" class="control-input" type="text" readonly />
                    <button class="copy-row__button" type="button" data-copy-target="overlay-url">Copy</button>
                  </div>
                </div>
                <div class="field">
                  <label class="field__label" for="overlay-loader-file-path">OBS local loader file</label>
                  <div class="copy-row">
                    <input id="overlay-loader-file-path" class="control-input" type="text" readonly aria-describedby="overlay-loader-hint" />
                    <button class="copy-row__button" type="button" data-copy-target="overlay-loader-file-path">Copy</button>
                  </div>
                  <span id="overlay-loader-hint" class="field__hint">In OBS, enable <strong>Local file</strong> and pick this file so the overlay reconnects when OBS opens before the app.</span>
                </div>
                <label class="field">
                  <span class="field__label">Overlay theme <span class="auto-badge">saves automatically</span></span>
                  <select id="theme-select" class="control-input"></select>
                </label>
                <label class="field">
                  <span class="field__label">Overlay scale <span class="auto-badge">saves automatically</span></span>
                  <span class="range-field range-field--bare">
                    <input id="overlay-scale-slider" class="range-field__input" type="range" min="50" max="200" step="5" value="100" />
                    <span id="overlay-scale-value" class="range-field__value">100%</span>
                  </span>
                </label>
              </div>

              <div class="panel__header panel__header--sub">
                <div>
                  <h3 class="panel__subtitle">YouTube OBS fallback</h3>
                  <p id="youtube-fallback-status" class="field__hint">Use an OBS Browser Source for YouTube videos that block embedded playback.</p>
                </div>
                <button id="youtube-fallback-login" class="secondary-button" type="button">Open YouTube Login Page</button>
              </div>
              <p id="youtube-fallback-feedback" class="feedback" role="status" aria-live="polite"></p>
              <div class="form-grid form-grid--3">
                <label class="toggle-card field--full" for="youtube-fallback-enabled-toggle">
                  <span class="toggle-card__copy">
                    <span class="toggle-card__title">Use OBS fallback for blocked YouTube videos</span>
                    <span class="toggle-card__body">When YouTube blocks the embedded player, the app switches a configured OBS Browser Source to the normal YouTube page.</span>
                  </span>
                  <input id="youtube-fallback-enabled-toggle" class="switch" type="checkbox" role="switch" />
                </label>
                <label class="field">
                  <span class="field__label">OBS WebSocket URL</span>
                  <input id="obs-websocket-url" class="control-input" type="text" placeholder="ws://127.0.0.1:4455" />
                </label>
                <label class="field">
                  <span class="field__label">OBS WebSocket password</span>
                  <input id="obs-websocket-password" class="control-input" type="password" autocomplete="new-password" />
                </label>
                <label class="field">
                  <span class="field__label">OBS Browser Source name</span>
                  <input id="obs-youtube-source-name" class="control-input" type="text" placeholder="YouTube Fallback" />
                </label>
              </div>
            </section>

            <section id="settings-playback" class="panel settings-section" aria-labelledby="settings-playback-heading">
              <h2 id="settings-playback-heading" class="panel__title">Playback</h2>
              <div class="form-grid form-grid--3">
                <label class="toggle-card" for="radio-mode-enabled-toggle">
                  <span class="toggle-card__copy">
                    <span class="toggle-card__title">Automatic radio</span>
                    <span class="toggle-card__body">Queue related tracks after the last viewer request finishes.</span>
                  </span>
                  <input id="radio-mode-enabled-toggle" class="switch" type="checkbox" role="switch" />
                </label>
                <label class="field">
                  <span class="field__label">Radio songs</span>
                  <input id="radio-track-count" class="control-input" type="number" min="1" max="10" step="1" aria-describedby="radio-track-count-hint" />
                  <span id="radio-track-count-hint" class="field__hint">Automatic tracks queued after the last request.</span>
                </label>
                <label class="field">
                  <span class="field__label">Player startup timeout (seconds)</span>
                  <input id="playback-startup-timeout-seconds" class="control-input" type="number" min="0" step="1" aria-describedby="playback-startup-timeout-hint" />
                  <span id="playback-startup-timeout-hint" class="field__hint">Report an error if YouTube or SoundCloud never starts. 0 turns this off.</span>
                </label>
              </div>
            </section>

            <section id="settings-categories" class="panel settings-section" aria-labelledby="settings-categories-heading">
              <h2 id="settings-categories-heading" class="panel__title">Category rules</h2>
              <p class="panel-note">Pause chat messages or music while your stream is in specific Twitch games or categories.</p>
              <div class="form-grid form-grid--halves">
                <fieldset class="rule-card">
                  <legend class="rule-card__title">Suppress chat messages</legend>
                  <p class="field__hint">The bot stops sending replies and now-playing messages.</p>
                  <div class="copy-row copy-row--triple">
                    <input id="chat-category-input" class="control-input" type="text" placeholder="Add category" aria-label="Category to suppress chat messages in" />
                    <button id="chat-category-add" class="copy-row__button" type="button">Add</button>
                    <button id="chat-category-delete" class="copy-row__button" type="button">Remove selected</button>
                  </div>
                  <label class="field">
                    <span class="field__label">Suppressed games / categories</span>
                    <select id="chat-category-select" class="control-input"></select>
                  </label>
                </fieldset>
                <fieldset class="rule-card">
                  <legend class="rule-card__title">Suppress music playback</legend>
                  <p class="field__hint">Playback stops completely.</p>
                  <div class="copy-row copy-row--triple">
                    <input id="playback-category-input" class="control-input" type="text" placeholder="Add category" aria-label="Category to suppress music playback in" />
                    <button id="playback-category-add" class="copy-row__button" type="button">Add</button>
                    <button id="playback-category-delete" class="copy-row__button" type="button">Remove selected</button>
                  </div>
                  <label class="field">
                    <span class="field__label">Suppressed games / categories</span>
                    <select id="playback-category-select" class="control-input"></select>
                  </label>
                </fieldset>
              </div>
            </section>

            <section id="settings-app" class="panel settings-section" aria-labelledby="settings-app-heading">
              <h2 id="settings-app-heading" class="panel__title">App</h2>
              <div class="form-grid form-grid--halves">
                <label class="field">
                  <span class="field__label">Local port</span>
                  <input id="port" name="port" class="control-input control-input--narrow" type="number" min="1" max="65535" aria-describedby="restart-note" />
                  <span id="restart-note" class="field__hint">Port changes are applied immediately when you restart the app.</span>
                </label>
                <div class="field">
                  <label class="toggle-card" for="start-with-windows-toggle">
                    <span class="toggle-card__copy">
                      <span class="toggle-card__title">Start with Windows</span>
                      <span id="start-with-windows-copy" class="toggle-card__body">Launch the desktop app automatically when you sign in to Windows.</span>
                    </span>
                    <input id="start-with-windows-toggle" class="switch" type="checkbox" role="switch" />
                  </label>
                  <span id="start-with-windows-note" class="field__hint">Only available in the packaged Windows desktop app.</span>
                </div>
              </div>
              <div class="button-row">
                <button id="check-for-updates-button" class="secondary-button" type="button">Check for updates</button>
                <button id="open-appdata-button" class="ghost-button" type="button">Open settings folder</button>
                <button id="export-diagnostics-button" class="ghost-button" type="button">Export diagnostics</button>
              </div>
              <p class="field__hint">Diagnostics download the current settings, runtime status, playback state, history, and admin activity as JSON.</p>
            </section>
          </form>
        </div>
      </section>
    </div>
  `;
  el("overview-player-frame")?.addEventListener("load", () => {
    syncGuiPlayerFrameVolume();
  });
  applyTabState();
}
function setFeedback(message, tone = "") {
  const feedback = el("save-feedback");
  if (!feedback) {
    return;
  }
  feedback.textContent = message;
  feedback.className = "feedback toast";
  if (tone) {
    feedback.classList.add(`is-${tone}`);
  }
  window.clearTimeout(saveFeedbackTimer);
  if (message && tone) {
    saveFeedbackTimer = window.setTimeout(() => {
      if (feedback.textContent === message) {
        feedback.textContent = "";
      }
    }, tone === "error" ? 15e3 : 6e3);
  }
}
function setPlaylistFeedback(message, tone = "") {
  const feedback = el("playlist-feedback");
  if (!feedback) {
    return;
  }
  feedback.textContent = message;
  feedback.className = "feedback";
  if (tone) {
    feedback.classList.add(`is-${tone}`);
  }
}
function setOverviewFeedback(message, tone = "") {
  const feedback = el("overview-feedback");
  if (!feedback) {
    return;
  }
  feedback.textContent = message;
  feedback.className = "feedback";
  if (tone) {
    feedback.classList.add(`is-${tone}`);
  }
}
function setYoutubeFallbackFeedback(message, tone = "") {
  const feedback = el("youtube-fallback-feedback");
  if (!feedback) {
    return;
  }
  feedback.textContent = message;
  feedback.className = "feedback";
  if (tone) {
    feedback.classList.add(`is-${tone}`);
  }
}
function setQueueFeedback(message, tone = "") {
  const feedback = el("queue-feedback");
  if (!feedback) {
    return;
  }
  feedback.textContent = message;
  feedback.className = "feedback";
  if (tone) {
    feedback.classList.add(`is-${tone}`);
  }
}
function setRequestsFeedback(message, tone = "") {
  const feedback = el("requests-feedback");
  if (!feedback) {
    return;
  }
  feedback.textContent = message;
  feedback.className = "feedback";
  if (tone) {
    feedback.classList.add(`is-${tone}`);
  }
}
function applyTabState() {
  DASHBOARD_TABS.forEach(({ id: tabId }) => {
    const button = root.querySelector(`[data-tab="${tabId}"]`);
    const view = el(`tab-${tabId}`);
    const isActive = activeTab === tabId;
    if (button) {
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.tabIndex = isActive ? 0 : -1;
    }
    if (view) {
      view.hidden = !isActive;
    }
  });
}
function selectTab(tabId, { focus = false } = {}) {
  if (!DASHBOARD_TABS.some(({ id }) => id === tabId)) {
    return;
  }
  activeTab = tabId;
  applyTabState();
  if (focus) {
    root.querySelector(`[data-tab="${tabId}"]`)?.focus();
  }
  if (activeTab === "library") {
    void loadPlaylist().catch((error) => setPlaylistFeedback(error?.message || "Could not load playlist.", "error"));
  }
  if (activeTab === "autodj") {
    void loadAutoDjStatus().catch((error) => setText("autodj-feedback", error?.message || "Could not load AutoDJ status."));
  }
}
function parseRequestPolicyList(value) {
  return String(value ?? "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}
function renderCategorySelect(selectId, items) {
  const select = el(selectId);
  if (!select) {
    return;
  }
  select.innerHTML = "";
  if (!items.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No categories configured";
    select.appendChild(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    select.appendChild(option);
  });
}
function renderThemeOptions(selectedTheme) {
  const select = el("theme-select");
  if (!select) {
    return;
  }
  select.innerHTML = "";
  availableThemes.forEach((theme) => {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.label;
    select.appendChild(option);
  });
  select.value = selectedTheme || "aurora";
}
function normalizeOverlayScalePercent(value) {
  const parsedValue = Number.parseInt(String(value ?? 100), 10);
  if (!Number.isFinite(parsedValue)) {
    return 100;
  }
  return Math.min(200, Math.max(50, parsedValue));
}
function renderOverlayScaleControl(scalePercent) {
  const slider = el("overlay-scale-slider");
  const valueLabel = el("overlay-scale-value");
  const normalizedScale = normalizeOverlayScalePercent(scalePercent);
  if (slider) {
    slider.value = String(normalizedScale);
  }
  if (valueLabel) {
    valueLabel.textContent = `${normalizedScale}%`;
  }
}
function getRequestPolicy() {
  return settingsPayload?.settings?.requestPolicy ?? {
    requestsEnabled: true,
    autoSaveCompletedRequests: true,
    accessLevel: "everyone",
    maxQueueLength: 0,
    maxRequestsPerUser: 0,
    duplicateHistoryCount: 0,
    cooldownSeconds: 0,
    maxTrackDurationSeconds: 0,
    rejectLiveStreams: false,
    allowSearchRequests: true,
    youtubeSafeSearch: "none",
    allowedProviders: ["youtube", "soundcloud", "spotify", "suno"],
    blockedYouTubeChannelIds: [],
    blockedSoundCloudUsers: [],
    blockedUsers: [],
    blockedDomains: [],
    blockedPhrases: []
  };
}
function getRequestPolicyAutosaveEnabled() {
  return settingsPayload?.settings?.requestPolicyAutosaveEnabled === true;
}
function clearRequestPolicyAutosaveTimer() {
  if (requestPolicyAutosaveTimer) {
    window.clearTimeout(requestPolicyAutosaveTimer);
    requestPolicyAutosaveTimer = null;
  }
}
function getDraftRequestPolicy() {
  if (requestPolicyDraft && typeof requestPolicyDraft === "object") {
    return {
      requestsEnabled: requestPolicyDraft.requestsEnabled !== false,
      autoSaveCompletedRequests: requestPolicyDraft.autoSaveCompletedRequests !== false,
      accessLevel: typeof requestPolicyDraft.accessLevel === "string" ? requestPolicyDraft.accessLevel : "everyone",
      maxQueueLength: Number.parseInt(String(requestPolicyDraft.maxQueueLength ?? 0), 10) || 0,
      maxRequestsPerUser: Number.parseInt(String(requestPolicyDraft.maxRequestsPerUser ?? 0), 10) || 0,
      duplicateHistoryCount: Number.parseInt(String(requestPolicyDraft.duplicateHistoryCount ?? 0), 10) || 0,
      cooldownSeconds: Number.parseInt(String(requestPolicyDraft.cooldownSeconds ?? 0), 10) || 0,
      maxTrackDurationSeconds: Number.parseInt(String(requestPolicyDraft.maxTrackDurationSeconds ?? 0), 10) || 0,
      rejectLiveStreams: requestPolicyDraft.rejectLiveStreams === true,
      allowSearchRequests: requestPolicyDraft.allowSearchRequests !== false,
      youtubeSafeSearch: typeof requestPolicyDraft.youtubeSafeSearch === "string" ? requestPolicyDraft.youtubeSafeSearch : "none",
      allowedProviders: Array.isArray(requestPolicyDraft.allowedProviders) ? requestPolicyDraft.allowedProviders.filter(Boolean) : ["youtube", "soundcloud", "spotify", "suno"],
      blockedYouTubeChannelIds: Array.isArray(requestPolicyDraft.blockedYouTubeChannelIds) ? requestPolicyDraft.blockedYouTubeChannelIds.filter(Boolean) : [],
      blockedSoundCloudUsers: Array.isArray(requestPolicyDraft.blockedSoundCloudUsers) ? requestPolicyDraft.blockedSoundCloudUsers.filter(Boolean) : [],
      blockedUsers: Array.isArray(requestPolicyDraft.blockedUsers) ? requestPolicyDraft.blockedUsers.filter(Boolean) : [],
      blockedDomains: Array.isArray(requestPolicyDraft.blockedDomains) ? requestPolicyDraft.blockedDomains.filter(Boolean) : [],
      blockedPhrases: Array.isArray(requestPolicyDraft.blockedPhrases) ? requestPolicyDraft.blockedPhrases.filter(Boolean) : []
    };
  }
  return getRequestPolicy();
}
function syncRequestPolicyDraftFromInputs() {
  const toggle = el("requests-enabled-toggle");
  const accessLevelSelect = el("requests-access-level");
  const maxQueueLengthInput = el("requests-max-queue-length");
  const maxPerUserInput = el("requests-max-per-user");
  const duplicateHistoryInput = el("requests-duplicate-history-count");
  const cooldownInput = el("requests-cooldown-seconds");
  const maxDurationInput = el("requests-max-duration-seconds");
  const blockedYoutubeChannelsInput = el("requests-blocked-youtube-channels");
  const blockedSoundCloudUsersInput = el("requests-blocked-soundcloud-users");
  const blockedUsersInput = el("requests-blocked-users");
  const blockedDomainsInput = el("requests-blocked-domains");
  const blockedPhrasesInput = el("requests-blocked-phrases");
  requestPolicyDraft = {
    requestsEnabled: toggle instanceof HTMLInputElement ? toggle.checked : getRequestPolicy().requestsEnabled !== false,
    autoSaveCompletedRequests: el("requests-auto-save-completed-toggle") instanceof HTMLInputElement ? el("requests-auto-save-completed-toggle").checked : getRequestPolicy().autoSaveCompletedRequests !== false,
    accessLevel: accessLevelSelect instanceof HTMLSelectElement ? accessLevelSelect.value : getRequestPolicy().accessLevel || "everyone",
    maxQueueLength: Number.parseInt(maxQueueLengthInput?.value || "0", 10) || 0,
    maxRequestsPerUser: Number.parseInt(maxPerUserInput?.value || "0", 10) || 0,
    duplicateHistoryCount: Number.parseInt(duplicateHistoryInput?.value || "0", 10) || 0,
    cooldownSeconds: Number.parseInt(cooldownInput?.value || "0", 10) || 0,
    maxTrackDurationSeconds: Number.parseInt(maxDurationInput?.value || "0", 10) || 0,
    rejectLiveStreams: el("requests-reject-live-toggle") instanceof HTMLInputElement ? el("requests-reject-live-toggle").checked : getRequestPolicy().rejectLiveStreams === true,
    allowSearchRequests: el("requests-allow-search-toggle") instanceof HTMLInputElement ? el("requests-allow-search-toggle").checked : getRequestPolicy().allowSearchRequests !== false,
    youtubeSafeSearch: el("requests-safe-search") instanceof HTMLSelectElement ? el("requests-safe-search").value : getRequestPolicy().youtubeSafeSearch || "none",
    allowedProviders: [
      el("requests-provider-youtube") instanceof HTMLInputElement && el("requests-provider-youtube").checked ? "youtube" : "",
      el("requests-provider-soundcloud") instanceof HTMLInputElement && el("requests-provider-soundcloud").checked ? "soundcloud" : "",
      el("requests-provider-spotify") instanceof HTMLInputElement && el("requests-provider-spotify").checked ? "spotify" : "",
      el("requests-provider-suno") instanceof HTMLInputElement && el("requests-provider-suno").checked ? "suno" : ""
    ].filter(Boolean),
    blockedYouTubeChannelIds: blockedYoutubeChannelsInput instanceof HTMLTextAreaElement ? parseRequestPolicyList(blockedYoutubeChannelsInput.value.toLowerCase()) : [...getRequestPolicy().blockedYouTubeChannelIds || []],
    blockedSoundCloudUsers: blockedSoundCloudUsersInput instanceof HTMLTextAreaElement ? parseRequestPolicyList(blockedSoundCloudUsersInput.value.toLowerCase()) : [...getRequestPolicy().blockedSoundCloudUsers || []],
    blockedUsers: blockedUsersInput instanceof HTMLTextAreaElement ? parseRequestPolicyList(blockedUsersInput.value.toLowerCase()) : [...getRequestPolicy().blockedUsers || []],
    blockedDomains: blockedDomainsInput instanceof HTMLTextAreaElement ? parseRequestPolicyList(blockedDomainsInput.value.toLowerCase()) : [...getRequestPolicy().blockedDomains || []],
    blockedPhrases: blockedPhrasesInput instanceof HTMLTextAreaElement ? parseRequestPolicyList(blockedPhrasesInput.value) : [...getRequestPolicy().blockedPhrases || []]
  };
}
function collectRequestPolicyPayload() {
  return {
    requestsEnabled: el("requests-enabled-toggle") instanceof HTMLInputElement ? el("requests-enabled-toggle").checked : true,
    autoSaveCompletedRequests: el("requests-auto-save-completed-toggle") instanceof HTMLInputElement ? el("requests-auto-save-completed-toggle").checked : true,
    accessLevel: el("requests-access-level") instanceof HTMLSelectElement ? el("requests-access-level").value : "everyone",
    maxQueueLength: Number.parseInt(el("requests-max-queue-length")?.value || "0", 10) || 0,
    maxRequestsPerUser: Number.parseInt(el("requests-max-per-user")?.value || "0", 10) || 0,
    duplicateHistoryCount: Number.parseInt(el("requests-duplicate-history-count")?.value || "0", 10) || 0,
    cooldownSeconds: Number.parseInt(el("requests-cooldown-seconds")?.value || "0", 10) || 0,
    maxTrackDurationSeconds: Number.parseInt(el("requests-max-duration-seconds")?.value || "0", 10) || 0,
    rejectLiveStreams: el("requests-reject-live-toggle") instanceof HTMLInputElement ? el("requests-reject-live-toggle").checked : false,
    allowSearchRequests: el("requests-allow-search-toggle") instanceof HTMLInputElement ? el("requests-allow-search-toggle").checked : true,
    youtubeSafeSearch: el("requests-safe-search") instanceof HTMLSelectElement ? el("requests-safe-search").value : "none",
    allowedProviders: [
      el("requests-provider-youtube") instanceof HTMLInputElement && el("requests-provider-youtube").checked ? "youtube" : "",
      el("requests-provider-soundcloud") instanceof HTMLInputElement && el("requests-provider-soundcloud").checked ? "soundcloud" : "",
      el("requests-provider-spotify") instanceof HTMLInputElement && el("requests-provider-spotify").checked ? "spotify" : "",
      el("requests-provider-suno") instanceof HTMLInputElement && el("requests-provider-suno").checked ? "suno" : ""
    ].filter(Boolean),
    blockedYouTubeChannelIds: parseRequestPolicyList(el("requests-blocked-youtube-channels")?.value || "").map((value) => value.toLowerCase()),
    blockedSoundCloudUsers: parseRequestPolicyList(el("requests-blocked-soundcloud-users")?.value || "").map((value) => value.toLowerCase()),
    blockedUsers: parseRequestPolicyList(el("requests-blocked-users")?.value || "").map((value) => value.toLowerCase()),
    blockedDomains: parseRequestPolicyList(el("requests-blocked-domains")?.value || "").map((value) => value.toLowerCase()),
    blockedPhrases: parseRequestPolicyList(el("requests-blocked-phrases")?.value || "")
  };
}
function requestPoliciesEqual(leftPolicy, rightPolicy) {
  return JSON.stringify(leftPolicy ?? {}) === JSON.stringify(rightPolicy ?? {});
}
function applyRequestAutosaveState() {
  const autosaveButton = el("requests-autosave-button");
  if (!(autosaveButton instanceof HTMLButtonElement)) {
    return;
  }
  const isEnabled = getRequestPolicyAutosaveEnabled();
  autosaveButton.textContent = isEnabled ? "Autosave On" : "Autosave Off";
  autosaveButton.className = `${isEnabled ? "secondary-button" : "ghost-button"} request-autosave-button`;
  autosaveButton.setAttribute("aria-pressed", isEnabled ? "true" : "false");
  autosaveButton.disabled = isRequestPolicyAutosaveSaving || isSavingSettings;
}
function requestStatusPresentation(isEnabled, accessLevel = "everyone") {
  return isEnabled ? {
    className: "status-pill status-pill--ok",
    text: "Requests open",
    copy: accessLevel === "everyone" ? "Viewer requests can be queued from chat." : `Chat requests are open, but limited to ${accessLevel}.`
  } : {
    className: "status-pill status-pill--warn",
    text: "Requests closed",
    copy: "Only moderators and the broadcaster can add requests from chat."
  };
}
function applyRequestPolicyState() {
  const toggle = el("requests-enabled-toggle");
  const requestPolicy = isHydratingForm ? getRequestPolicy() : getDraftRequestPolicy();
  const isEnabled = requestPolicy.requestsEnabled !== false;
  const presentation = requestStatusPresentation(isEnabled, requestPolicy.accessLevel || "everyone");
  const headerPill = el("requests-status-pill");
  const tabPill = el("requests-tab-pill");
  const statusCopy = el("requests-status-copy");
  const maxQueueLengthInput = el("requests-max-queue-length");
  const maxPerUserInput = el("requests-max-per-user");
  const duplicateHistoryInput = el("requests-duplicate-history-count");
  const accessLevelSelect = el("requests-access-level");
  const cooldownInput = el("requests-cooldown-seconds");
  const maxDurationInput = el("requests-max-duration-seconds");
  const rejectLiveToggle = el("requests-reject-live-toggle");
  const allowSearchToggle = el("requests-allow-search-toggle");
  const safeSearchSelect = el("requests-safe-search");
  const youtubeProviderToggle = el("requests-provider-youtube");
  const soundCloudProviderToggle = el("requests-provider-soundcloud");
  const spotifyProviderToggle = el("requests-provider-spotify");
  const sunoProviderToggle = el("requests-provider-suno");
  const blockedYoutubeChannelsInput = el("requests-blocked-youtube-channels");
  const blockedSoundCloudUsersInput = el("requests-blocked-soundcloud-users");
  const blockedUsersInput = el("requests-blocked-users");
  const blockedDomainsInput = el("requests-blocked-domains");
  const blockedPhrasesInput = el("requests-blocked-phrases");
  if (headerPill) {
    headerPill.className = presentation.className;
    headerPill.textContent = presentation.text;
  }
  if (tabPill) {
    tabPill.className = presentation.className;
    tabPill.textContent = presentation.text;
  }
  if (statusCopy) {
    statusCopy.textContent = presentation.copy;
  }
  if (toggle instanceof HTMLInputElement) {
    toggle.checked = isEnabled;
  }
  const autoSaveCompletedToggle = el("requests-auto-save-completed-toggle");
  if (autoSaveCompletedToggle instanceof HTMLInputElement) {
    autoSaveCompletedToggle.checked = requestPolicy.autoSaveCompletedRequests !== false;
  }
  if (accessLevelSelect instanceof HTMLSelectElement) {
    accessLevelSelect.value = requestPolicy.accessLevel || "everyone";
  }
  if (maxQueueLengthInput instanceof HTMLInputElement) {
    maxQueueLengthInput.value = String(requestPolicy.maxQueueLength ?? 0);
  }
  if (maxPerUserInput instanceof HTMLInputElement) {
    maxPerUserInput.value = String(requestPolicy.maxRequestsPerUser ?? 0);
  }
  if (duplicateHistoryInput instanceof HTMLInputElement) {
    duplicateHistoryInput.value = String(requestPolicy.duplicateHistoryCount ?? 0);
  }
  if (cooldownInput instanceof HTMLInputElement) {
    cooldownInput.value = String(requestPolicy.cooldownSeconds ?? 0);
  }
  if (maxDurationInput instanceof HTMLInputElement) {
    maxDurationInput.value = String(requestPolicy.maxTrackDurationSeconds ?? 0);
  }
  if (rejectLiveToggle instanceof HTMLInputElement) {
    rejectLiveToggle.checked = requestPolicy.rejectLiveStreams === true;
  }
  if (allowSearchToggle instanceof HTMLInputElement) {
    allowSearchToggle.checked = requestPolicy.allowSearchRequests !== false;
  }
  if (safeSearchSelect instanceof HTMLSelectElement) {
    safeSearchSelect.value = requestPolicy.youtubeSafeSearch || "none";
  }
  if (youtubeProviderToggle instanceof HTMLInputElement) {
    youtubeProviderToggle.checked = (requestPolicy.allowedProviders || []).includes("youtube");
  }
  if (soundCloudProviderToggle instanceof HTMLInputElement) {
    soundCloudProviderToggle.checked = (requestPolicy.allowedProviders || []).includes("soundcloud");
  }
  if (spotifyProviderToggle instanceof HTMLInputElement) {
    spotifyProviderToggle.checked = (requestPolicy.allowedProviders || []).includes("spotify");
  }
  if (sunoProviderToggle instanceof HTMLInputElement) {
    sunoProviderToggle.checked = (requestPolicy.allowedProviders || []).includes("suno");
  }
  if (blockedYoutubeChannelsInput instanceof HTMLTextAreaElement) {
    blockedYoutubeChannelsInput.value = (requestPolicy.blockedYouTubeChannelIds || []).join("\n");
  }
  if (blockedSoundCloudUsersInput instanceof HTMLTextAreaElement) {
    blockedSoundCloudUsersInput.value = (requestPolicy.blockedSoundCloudUsers || []).join("\n");
  }
  if (blockedUsersInput instanceof HTMLTextAreaElement) {
    blockedUsersInput.value = (requestPolicy.blockedUsers || []).join("\n");
  }
  if (blockedDomainsInput instanceof HTMLTextAreaElement) {
    blockedDomainsInput.value = (requestPolicy.blockedDomains || []).join("\n");
  }
  if (blockedPhrasesInput instanceof HTMLTextAreaElement) {
    blockedPhrasesInput.value = (requestPolicy.blockedPhrases || []).join("\n");
  }
  applyRequestAutosaveState();
}
function applyYoutubeFallbackState() {
  const settings = settingsPayload?.settings ?? {};
  const enabledToggle = el("youtube-fallback-enabled-toggle");
  const loginButton = el("youtube-fallback-login");
  const status = el("youtube-fallback-status");
  const isEnabled = settings.obsYoutubeFallbackEnabled === true;
  const sourceName = settings.obsYoutubeFallbackSourceName || "";
  if (isHydratingForm && enabledToggle instanceof HTMLInputElement) {
    enabledToggle.checked = isEnabled;
  }
  if (isHydratingForm) {
    setValue("obs-websocket-url", settings.obsWebSocketUrl || "ws://127.0.0.1:4455");
    setValue("obs-youtube-source-name", sourceName);
    setValue("obs-websocket-password", "");
  }
  if (el("obs-websocket-password") instanceof HTMLInputElement) {
    el("obs-websocket-password").placeholder = settings.hasObsWebSocketPassword ? "Saved password hidden" : "";
  }
  if (loginButton instanceof HTMLButtonElement) {
    loginButton.disabled = !isEnabled || isSavingSettings;
  }
  if (status) {
    if (!isEnabled) {
      status.textContent = "Use an OBS Browser Source for YouTube videos that block embedded playback.";
    } else if (!sourceName) {
      status.textContent = "Enter the OBS Browser Source name, save, then open YouTube to log in.";
    } else {
      status.textContent = `Fallback source: ${sourceName}`;
    }
  }
}
function renderChatCommandRows(chatCommands) {
  const tableBody = el("chat-commands-body");
  if (!tableBody) {
    return;
  }
  tableBody.innerHTML = "";
  Object.values(chatCommands ?? {}).forEach((command) => {
    const row = document.createElement("tr");
    row.setAttribute("data-chat-command-id", command.id);
    row.innerHTML = `
      <td>
        <strong>${htmlEscape(command.label)}</strong>
        <div class="command-table__description">${htmlEscape(command.description)}</div>
      </td>
      <td>
        <input class="control-input" data-chat-command-field="trigger" type="text" value="${htmlEscape(command.trigger)}" />
      </td>
      <td>
        <input class="control-input" data-chat-command-field="aliases" type="text" value="${htmlEscape((command.aliases || []).join(", "))}" placeholder="!alias1, !alias2" />
      </td>
      <td>
        <select class="control-input" data-chat-command-field="permission">
          <option value="everyone">Everyone</option>
          <option value="vip">VIP / Mod / Broadcaster</option>
          <option value="moderator">Mod / Broadcaster</option>
          <option value="broadcaster">Broadcaster only</option>
        </select>
      </td>
      <td>
        <label class="command-toggle">
          <input data-chat-command-field="enabled" type="checkbox" ${command.enabled ? "checked" : ""} />
          <span>${command.enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </td>
    `;
    row.querySelector('[data-chat-command-field="permission"]').value = command.permission || "everyone";
    tableBody.appendChild(row);
  });
}
function collectChatCommandsPayload() {
  const rows = root.querySelectorAll("[data-chat-command-id]");
  return Object.fromEntries(
    Array.from(rows, (row) => {
      const commandId = row.getAttribute("data-chat-command-id") || "";
      const triggerInput = row.querySelector('[data-chat-command-field="trigger"]');
      const aliasesInput = row.querySelector('[data-chat-command-field="aliases"]');
      const permissionInput = row.querySelector('[data-chat-command-field="permission"]');
      const enabledInput = row.querySelector('[data-chat-command-field="enabled"]');
      return [
        commandId,
        {
          trigger: triggerInput instanceof HTMLInputElement ? triggerInput.value.trim() : "",
          aliases: aliasesInput instanceof HTMLInputElement ? aliasesInput.value.split(",").map((value) => value.trim()).filter(Boolean) : [],
          permission: permissionInput instanceof HTMLSelectElement ? permissionInput.value : "everyone",
          enabled: enabledInput instanceof HTMLInputElement ? enabledInput.checked : false
        }
      ];
    })
  );
}
function settingsControls() {
  const fields = {
    twitchChannel: "twitchChannel",
    twitchUsername: "twitchUsername",
    twitchOauthToken: "twitchOauthToken",
    twitchClientId: "twitchClientId",
    twitchClientSecret: "twitchClientSecret",
    youtubeApiKey: "youtubeApiKey",
    port: "port",
    "twitch-shared-chat-source-only-toggle": "twitchSharedChatForSourceOnly",
    "twitch-track-announcement-mode": "twitchTrackAnnouncementMode",
    "start-with-windows-toggle": "startWithWindows",
    "playback-startup-timeout-seconds": "playerStartupTimeoutSeconds",
    "youtube-fallback-enabled-toggle": "obsYoutubeFallbackEnabled",
    "obs-websocket-url": "obsWebSocketUrl",
    "obs-websocket-password": "obsWebSocketPassword",
    "obs-youtube-source-name": "obsYoutubeFallbackSourceName",
    "radio-mode-enabled-toggle": "radioModeEnabled",
    "radio-track-count": "radioTrackCount",
    "autodj-service-url": "autoDjServiceUrl",
    "autodj-browser-output-url": "autoDjBrowserOutputUrl",
    "autodj-service-token": "autoDjServiceToken",
    "autodj-lease-seconds": "autoDjServiceLeaseSeconds"
  };
  const controls = Object.entries(fields).map(([id, setting]) => ({ id, setting, element: el(id) }));
  root.querySelectorAll("#tab-requests input[id], #tab-requests select[id], #tab-requests textarea[id]").forEach((element) => {
    if (element.id.startsWith("requests-")) controls.push({ id: element.id, setting: "requestPolicy", element });
  });
  root.querySelectorAll("[data-chat-command-field]").forEach((element) => {
    const command = element.closest("[data-chat-command-id]").dataset.chatCommandId;
    controls.push({ id: `command:${command}:${element.dataset.chatCommandField}`, setting: "chatCommands", element });
  });
  return controls.filter(({ element }) => element);
}
function captureSettingsDraft() {
  const draft = Object.fromEntries(settingsControls().map(({ id, setting, element }) => [id, {
    setting,
    value: element.type === "checkbox" ? element.checked : element.value
  }]));
  for (const [id, setting] of [["chat-category-select", "chatSuppressedCategories"], ["playback-category-select", "playbackSuppressedCategories"]]) {
    draft[id] = { setting, value: Array.from(el(id)?.options || [], (option) => option.value).filter(Boolean) };
  }
  return draft;
}
function pendingSettingsDraft(current = captureSettingsDraft()) {
  if (!savedSettingsDraft) return {};
  return Object.fromEntries(Object.entries(current).filter(
    ([id, entry]) => JSON.stringify(entry.value) !== JSON.stringify(savedSettingsDraft[id]?.value)
  ));
}
function restoreSettingsDraft(draft) {
  for (const { id, element } of settingsControls()) {
    if (!Object.hasOwn(draft, id)) continue;
    if (element.type === "checkbox") element.checked = draft[id].value;
    else element.value = draft[id].value;
    if (element.dataset.chatCommandField === "enabled") {
      element.closest(".command-toggle").querySelector("span").textContent = element.checked ? "Enabled" : "Disabled";
    }
  }
  if (draft["chat-category-select"]) chatSuppressedCategories = [...draft["chat-category-select"].value];
  if (draft["playback-category-select"]) playbackSuppressedCategories = [...draft["playback-category-select"].value];
  renderCategorySelect("chat-category-select", chatSuppressedCategories);
  renderCategorySelect("playback-category-select", playbackSuppressedCategories);
  syncRequestPolicyDraftFromInputs();
  const radioCount = el("radio-track-count");
  if (radioCount) radioCount.disabled = !el("radio-mode-enabled-toggle").checked;
}
function updateSettingsSaveState() {
  const button = el("save-button");
  if (!button || !savedSettingsDraft || isHydratingForm) return;
  const pending = pendingSettingsDraft();
  const entries = Object.values(pending);
  const busy = isSavingSettings || isRequestPolicyAutosaveSaving;
  if (!entries.length && !busy) settingsSaveError = "";
  const automatic = entries.length > 0 && entries.every(({ setting }) => setting === "requestPolicy") && getRequestPolicyAutosaveEnabled() && (requestPolicyAutosaveTimer || isRequestPolicyAutosaveSaving);
  const sections = /* @__PURE__ */ new Set();
  for (const { id, element } of settingsControls()) {
    if (pending[id]) sections.add(element.closest(".atlas-view")?.id.replace("tab-", ""));
  }
  if (pending["chat-category-select"] || pending["playback-category-select"]) sections.add("settings");
  root.querySelectorAll("[data-tab]").forEach((tab) => {
    const changed = sections.has(tab.dataset.tab);
    tab.classList.toggle("has-unsaved-settings", changed);
    tab.setAttribute("aria-label", `${tab.textContent.trim()}${changed ? " (unsaved changes)" : ""}`);
  });
  const sectionNames = DASHBOARD_TABS.filter(({ id }) => sections.has(id)).map(({ label }) => label);
  const title = busy ? "Saving changes\u2026" : settingsSaveError ? "Changes could not be saved" : automatic ? "Saving automatically\u2026" : entries.length ? "Unsaved changes" : "All changes saved";
  const detail = settingsSaveError || (entries.length ? `${sectionNames.join(", ")} \xB7 ${automatic ? "Request autosave is on." : "Click Save changes to apply your edits."}` : settingsSaveNotice || "You\u2019re up to date. Controls marked automatic save as you change them.");
  setText("settings-save-status", title);
  setText("settings-save-detail", detail);
  button.disabled = busy || entries.length === 0;
  button.textContent = busy ? "Saving\u2026" : settingsSaveError ? "Retry save" : "Save changes";
  const bar = button.closest(".settings-save-bar");
  bar.dataset.state = settingsSaveError ? "error" : entries.length ? "pending" : "saved";
  bar.setAttribute("aria-busy", busy ? "true" : "false");
  setText("requests-save-note", getRequestPolicyAutosaveEnabled() ? "Request controls save automatically. Chat commands still need Save changes below." : "Request controls and chat commands apply with Save changes below. Turn on Autosave for automatic request-control saves.");
}
function collectSettingsPayload() {
  const payload = {
    twitchChannel: el("twitchChannel")?.value.trim() || "",
    twitchUsername: el("twitchUsername")?.value.trim() || "",
    twitchClientId: el("twitchClientId")?.value.trim() || "",
    twitchTrackAnnouncementMode: el("twitch-track-announcement-mode")?.value || "all",
    twitchSharedChatForSourceOnly: el("twitch-shared-chat-source-only-toggle") instanceof HTMLInputElement ? el("twitch-shared-chat-source-only-toggle").checked : false,
    youtubeApiKey: el("youtubeApiKey")?.value.trim() || "",
    port: Number.parseInt(el("port")?.value || "3000", 10) || 3e3,
    startWithWindows: el("start-with-windows-toggle") instanceof HTMLInputElement ? el("start-with-windows-toggle").checked : false,
    guiPlayerEnabled: settingsPayload?.settings?.guiPlayerEnabled === true,
    guiPlayerVolume,
    overlayScalePercent: normalizeOverlayScalePercent(
      el("overlay-scale-slider")?.value || lastSavedOverlayScalePercent
    ),
    playerStartupTimeoutSeconds: Number.parseInt(el("playback-startup-timeout-seconds")?.value || "15", 10) || 0,
    obsYoutubeFallbackEnabled: el("youtube-fallback-enabled-toggle") instanceof HTMLInputElement ? el("youtube-fallback-enabled-toggle").checked : false,
    obsWebSocketUrl: el("obs-websocket-url")?.value.trim() || "ws://127.0.0.1:4455",
    obsYoutubeFallbackSourceName: el("obs-youtube-source-name")?.value.trim() || "",
    radioModeEnabled: el("radio-mode-enabled-toggle") instanceof HTMLInputElement ? el("radio-mode-enabled-toggle").checked : false,
    radioTrackCount: Number.parseInt(el("radio-track-count")?.value || "3", 10) || 3,
    requestPolicyAutosaveEnabled: getRequestPolicyAutosaveEnabled(),
    requestPolicy: collectRequestPolicyPayload(),
    chatCommands: collectChatCommandsPayload(),
    theme: el("theme-select")?.value || lastSavedTheme,
    chatSuppressedCategories,
    playbackSuppressedCategories
  };
  const twitchOauthToken = el("twitchOauthToken")?.value.trim() || "";
  const twitchClientSecret = el("twitchClientSecret")?.value.trim() || "";
  const obsWebSocketPassword = el("obs-websocket-password")?.value.trim() || "";
  const autoDjServiceToken = el("autodj-service-token")?.value.trim() || "";
  payload.autoDjServiceUrl = el("autodj-service-url")?.value.trim() || "";
  payload.autoDjBrowserOutputUrl = el("autodj-browser-output-url")?.value.trim() || "";
  payload.autoDjServiceLeaseSeconds = Number.parseInt(
    el("autodj-lease-seconds")?.value || "90",
    10
  ) || 90;
  if (twitchOauthToken) {
    payload.twitchOauthToken = twitchOauthToken;
  }
  if (twitchClientSecret) {
    payload.twitchClientSecret = twitchClientSecret;
  }
  if (obsWebSocketPassword) {
    payload.obsWebSocketPassword = obsWebSocketPassword;
  }
  if (autoDjServiceToken) {
    payload.autoDjServiceToken = autoDjServiceToken;
  }
  return payload;
}
async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options
  });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const errorPayload = await response.json();
      if (typeof errorPayload?.error === "string" && errorPayload.error) {
        message = errorPayload.error;
      }
    } catch {
    }
    throw new Error(message);
  }
  return response.json();
}
function renderAutoDjStatus() {
  const status = autoDjStatus;
  const connection = status?.connection ?? {};
  const activation = status?.activation ?? {};
  const connectionPill = el("autodj-connection-pill");
  const activationPill = el("autodj-activation-pill");
  const responding = connection.responding === true;
  const recentlySeen = connection.state === "recently-seen";
  if (connectionPill) {
    connectionPill.className = responding ? "status-pill status-pill--ok" : recentlySeen ? "status-pill status-pill--warn" : "status-pill status-pill--error";
    connectionPill.textContent = responding ? "Connected" : recentlySeen ? "Recently seen" : status?.configured ? "Unavailable" : "Unconfigured";
  }
  if (activationPill) {
    activationPill.className = activation.synchronized ? activation.effective ? "status-pill status-pill--ok" : "status-pill status-pill--idle" : "status-pill status-pill--warn";
    activationPill.textContent = !responding && activation.desired === false ? "Normal playback" : activation.synchronized ? activation.effective ? "Enabled" : "Disabled" : activation.desired ? "Enable pending" : "Disable pending";
  }
  const activationButton = el("autodj-activation");
  if (activationButton instanceof HTMLButtonElement) {
    activationButton.textContent = activation.desired ? "Use normal playback" : "Resume AutoDJ";
    activationButton.disabled = isAutoDjActivationPending || isPlaybackCommandPending;
  }
  const mixNextButton = el("autodj-mix-next");
  if (mixNextButton instanceof HTMLButtonElement) {
    mixNextButton.disabled = !responding || !activation.desired || !activation.synchronized || status?.takeover?.active;
  }
  setText("autodj-current-track", status?.currentTrack?.title || "No AutoDJ state received.");
  setText("autodj-last-seen", `Last seen: ${connection.lastSeenAt ? new Date(connection.lastSeenAt).toLocaleString() : "never"}`);
  setText(
    "autodj-takeover",
    status?.takeover?.active ? `Viewer-request takeover active${status.takeover.expiresAt ? ` until ${new Date(status.takeover.expiresAt).toLocaleTimeString()}` : ""}.` : "Viewer-request takeover inactive."
  );
  const upcoming = el("autodj-upcoming");
  if (upcoming) {
    upcoming.innerHTML = "";
    const tracks = Array.isArray(status?.upcomingTracks) ? status.upcomingTracks : [];
    if (tracks.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No upcoming tracks reported.";
      upcoming.appendChild(empty);
    } else {
      for (const track of tracks) {
        const item = document.createElement("article");
        item.className = "history-item";
        const title = document.createElement("strong");
        title.textContent = track.title || track.name || "Untitled track";
        item.appendChild(title);
        upcoming.appendChild(item);
      }
    }
  }
  setText("autodj-feedback", status?.error || "");
  applyPlaybackState();
}
async function loadAutoDjStatus() {
  autoDjStatus = await fetchJson("/api/autodj-service/status");
  renderAutoDjStatus();
  await loadAutoDjPairingRequests();
  return autoDjStatus;
}
async function loadAutoDjPairingRequests() {
  const payload = await fetchJson("/api/lan-pairing/requests");
  const container = el("autodj-pairing-requests");
  if (!container) return;
  container.innerHTML = "";
  for (const request of Array.isArray(payload?.requests) ? payload.requests : []) {
    const item = document.createElement("article");
    item.className = "history-item";
    const label = document.createElement("strong");
    label.textContent = `${request.displayName || "AutoDJ"} wants to pair`;
    const details = document.createElement("span");
    details.textContent = request.hostname || request.address || "Local network";
    const actions = document.createElement("div");
    actions.className = "button-row";
    for (const decision of ["accepted", "declined"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = decision === "accepted" ? "primary-button" : "ghost-button";
      button.textContent = decision === "accepted" ? "Accept" : "Decline";
      button.dataset.autodjPairingDecision = decision;
      button.dataset.autodjPairingRequestId = request.requestId;
      actions.appendChild(button);
    }
    item.append(label, details, actions);
    container.appendChild(item);
  }
}
async function answerAutoDjPairing(requestId, decision) {
  try {
    await fetchJson(`/api/lan-pairing/requests/${encodeURIComponent(requestId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision })
    });
    await loadAutoDjPairingRequests();
  } catch (error) {
    setText("autodj-feedback", error?.message || "Could not answer the pairing request.");
  }
}
async function setAutoDjActivation() {
  if (isAutoDjActivationPending || isPlaybackCommandPending) return;
  const desired = !(autoDjStatus?.activation?.desired === true);
  isAutoDjActivationPending = true;
  renderAutoDjStatus();
  setText("autodj-feedback", desired ? "Resuming AutoDJ..." : "Pausing AutoDJ for normal playback...");
  try {
    if (desired) {
      const pairing = collectSettingsPayload();
      settingsPayload = await persistSettings(Object.fromEntries(Object.entries(pairing).filter(
        ([key]) => ["autoDjServiceUrl", "autoDjBrowserOutputUrl", "autoDjServiceToken", "autoDjServiceLeaseSeconds"].includes(key)
      )));
      applySettingsPayload();
    }
    autoDjStatus = await fetchJson("/api/autodj-service/activation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: desired })
    });
    renderAutoDjStatus();
    await loadPlaybackState();
  } catch (error) {
    setText("autodj-feedback", error?.message || "AutoDJ activation failed.");
    await loadAutoDjStatus().catch(() => {
    });
  } finally {
    isAutoDjActivationPending = false;
    renderAutoDjStatus();
  }
}
async function mixNextAutoDj() {
  try {
    await fetchJson("/api/autodj-service/mix-next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadSeconds: 5 })
    });
    await loadAutoDjStatus();
  } catch (error) {
    setText("autodj-feedback", error?.message || "Mix Next failed.");
  }
}
async function discoverAutoDj() {
  setText("autodj-feedback", "Searching the local network for AutoDJ...");
  try {
    const result = await fetchJson("/api/lan-discovery/autodj", { method: "POST" });
    const peer = Array.isArray(result?.peers) ? result.peers[0] : null;
    if (!peer) {
      setText("autodj-feedback", "No standalone AutoDJ app answered the discovery request.");
      return;
    }
    const serviceUrl = peer.serviceUrl || peer.url || (peer.address && peer.servicePort ? `http://${peer.address}:${peer.servicePort}` : "");
    if (serviceUrl) setValue("autodj-service-url", serviceUrl);
    updateSettingsSaveState();
    setText("autodj-feedback", `Found ${peer.displayName || "AutoDJ"}. Save changes below to pair this controller.`);
  } catch (error) {
    setText("autodj-feedback", error?.message || "AutoDJ discovery failed.");
  }
}
async function loadSettings() {
  settingsPayload = await fetchJson("/api/settings");
  availableThemes = Array.isArray(settingsPayload.themeOptions) ? settingsPayload.themeOptions : [];
  lastSavedTheme = settingsPayload.settings.theme || "aurora";
  lastSavedOverlayScalePercent = normalizeOverlayScalePercent(
    settingsPayload.settings.overlayScalePercent
  );
  chatSuppressedCategories = Array.isArray(settingsPayload.settings.chatSuppressedCategories) ? [...settingsPayload.settings.chatSuppressedCategories] : [];
  playbackSuppressedCategories = Array.isArray(settingsPayload.settings.playbackSuppressedCategories) ? [...settingsPayload.settings.playbackSuppressedCategories] : [];
  guiPlayerVolume = Number.isFinite(settingsPayload.settings.guiPlayerVolume) ? settingsPayload.settings.guiPlayerVolume : 100;
  if (!root.childElementCount) {
    renderDashboard();
  }
  applySettingsPayload();
}
function applySettingsPayload() {
  if (!settingsPayload) {
    return;
  }
  const pendingDraft = pendingSettingsDraft();
  const focused = settingsControls().find(({ element }) => element === document.activeElement);
  const selection = focused ? [focused.element.selectionStart, focused.element.selectionEnd] : null;
  isHydratingForm = true;
  chatSuppressedCategories = [...settingsPayload.settings.chatSuppressedCategories || []];
  playbackSuppressedCategories = [...settingsPayload.settings.playbackSuppressedCategories || []];
  requestPolicyDraft = null;
  renderThemeOptions(settingsPayload.settings.theme);
  renderOverlayScaleControl(settingsPayload.settings.overlayScalePercent);
  setValue("twitchChannel", settingsPayload.settings.twitchChannel || "");
  setValue("twitchUsername", settingsPayload.settings.twitchUsername || "");
  setValue("twitchOauthToken", "");
  if (el("twitchOauthToken") instanceof HTMLInputElement) {
    el("twitchOauthToken").placeholder = settingsPayload.settings.hasTwitchOauthToken ? "Saved token hidden" : "";
  }
  setValue("twitchClientId", settingsPayload.settings.twitchClientId || "");
  setValue("twitchClientSecret", "");
  if (el("twitchClientSecret") instanceof HTMLInputElement) {
    el("twitchClientSecret").placeholder = settingsPayload.settings.hasTwitchClientSecret ? "Saved secret hidden" : "";
  }
  const sharedChatSourceOnlyToggle = el("twitch-shared-chat-source-only-toggle");
  setValue("twitch-track-announcement-mode", settingsPayload.settings.twitchTrackAnnouncementMode || "all");
  if (sharedChatSourceOnlyToggle instanceof HTMLInputElement) {
    sharedChatSourceOnlyToggle.checked = settingsPayload.settings.twitchSharedChatForSourceOnly === true;
  }
  if (el("youtubeApiKey")?.value !== (settingsPayload.settings.youtubeApiKey || "")) {
    resetYouTubeApiCheck();
  }
  setValue("youtubeApiKey", settingsPayload.settings.youtubeApiKey || "");
  setValue("port", settingsPayload.settings.port || 3e3);
  setValue("autodj-service-url", settingsPayload.settings.autoDjServiceUrl || "");
  setValue("autodj-browser-output-url", settingsPayload.settings.autoDjBrowserOutputUrl || "");
  setValue("autodj-service-token", "");
  setValue("autodj-lease-seconds", settingsPayload.settings.autoDjServiceLeaseSeconds ?? 90);
  if (el("autodj-service-token") instanceof HTMLInputElement) {
    el("autodj-service-token").placeholder = settingsPayload.settings.hasAutoDjServiceToken ? "Saved token hidden" : "";
  }
  renderCategorySelect("chat-category-select", chatSuppressedCategories);
  renderCategorySelect("playback-category-select", playbackSuppressedCategories);
  renderChatCommandRows(settingsPayload.settings.chatCommands || {});
  const startWithWindowsToggle = el("start-with-windows-toggle");
  if (startWithWindowsToggle instanceof HTMLInputElement) {
    startWithWindowsToggle.checked = settingsPayload.settings.startWithWindows === true;
  }
  setValue(
    "playback-startup-timeout-seconds",
    settingsPayload.settings.playerStartupTimeoutSeconds ?? 15
  );
  const radioModeEnabledToggle = el("radio-mode-enabled-toggle");
  const radioTrackCountInput = el("radio-track-count");
  const radioModeEnabled = settingsPayload.settings.radioModeEnabled === true;
  if (radioModeEnabledToggle instanceof HTMLInputElement) {
    radioModeEnabledToggle.checked = radioModeEnabled;
  }
  if (radioTrackCountInput instanceof HTMLInputElement) {
    radioTrackCountInput.value = String(settingsPayload.settings.radioTrackCount ?? 3);
    radioTrackCountInput.disabled = !radioModeEnabled;
  }
  applyRequestPolicyState();
  applyYoutubeFallbackState();
  applyRuntimeState();
  applyGuiPlayerState();
  savedSettingsDraft = captureSettingsDraft();
  restoreSettingsDraft(pendingDraft);
  if (focused) {
    const control = settingsControls().find(({ id }) => id === focused.id)?.element;
    control?.focus({ preventScroll: true });
    if (control && selection?.[0] != null) control.setSelectionRange(...selection);
  }
  isHydratingForm = false;
  updateSettingsSaveState();
}
function categoryBadgeState(categoryLookup) {
  const state = categoryLookup?.state || "inactive";
  if (state === "ok") {
    return {
      className: "status-pill status-pill--ok",
      text: categoryLookup?.categoryName ? `Category ${categoryLookup.categoryName}` : "Category OK"
    };
  }
  if (state === "oauth_error") {
    return {
      className: "status-pill status-pill--error",
      text: "OAuth issue"
    };
  }
  if (state === "error") {
    return {
      className: "status-pill status-pill--warn",
      text: "Category error"
    };
  }
  if (state === "checking") {
    return {
      className: "status-pill status-pill--warn",
      text: "Checking category"
    };
  }
  return {
    className: "status-pill status-pill--idle",
    text: "Category inactive"
  };
}
function applyRuntimeState() {
  if (!settingsPayload) {
    return;
  }
  const { runtime, twitchStatus, twitchAuthStatus, desktopIntegration } = settingsPayload;
  const statusState = twitchStatus?.state || "needs_configuration";
  const twitchPill = el("twitch-status-pill");
  const categoryPill = el("twitch-category-pill");
  const categoryStatus = categoryBadgeState(twitchStatus?.categoryLookup);
  setText("server-port-pill", `Port ${runtime.activePort}`);
  setText("twitch-status-text", twitchStatus?.message || "Waiting for configuration.");
  setValue("overlay-url", runtime.overlayUrl || "");
  setValue("overlay-loader-file-path", runtime.overlayLoaderFilePath || "");
  if (twitchPill) {
    twitchPill.className = "status-pill";
    twitchPill.title = twitchStatus?.message || "";
    if (statusState === "connected") {
      twitchPill.classList.add("status-pill--ok");
      twitchPill.textContent = "Chat connected";
    } else if (statusState === "error") {
      twitchPill.classList.add("status-pill--error");
      twitchPill.textContent = "Chat error";
    } else if (statusState === "connecting") {
      twitchPill.classList.add("status-pill--warn");
      twitchPill.textContent = "Chat connecting";
    } else {
      twitchPill.classList.add("status-pill--idle");
      twitchPill.textContent = "Chat setup";
    }
  }
  if (categoryPill) {
    categoryPill.className = categoryStatus.className;
    categoryPill.textContent = categoryStatus.text;
    categoryPill.title = twitchStatus?.categoryLookup?.message || "";
  }
  if (runtime.pendingRestart) {
    if (runtime.usingFallbackPort) {
      setText("restart-note", `Configured port ${runtime.configuredPort} was unavailable at startup, so the app is currently using fallback port ${runtime.activePort}.`);
    } else {
      setText("restart-note", `Saved port ${el("port")?.value || runtime.activePort} will be used after restart. The current server is still running on port ${runtime.activePort}.`);
    }
  } else {
    setText("restart-note", "Port changes are applied immediately when you restart the app.");
  }
  setText("twitch-auth-status-text", twitchAuthStatus?.message || "Use the bundled Twitch Client ID to start the in-app bot login flow.");
  setValue("twitch-auth-code", twitchAuthStatus?.userCode || "");
  setValue("twitch-auth-url", twitchAuthStatus?.verificationUriComplete || twitchAuthStatus?.verificationUri || "");
  const authDetails = el("twitch-auth-details");
  if (authDetails) {
    authDetails.hidden = !(twitchAuthStatus?.userCode || "" || (twitchAuthStatus?.verificationUriComplete || twitchAuthStatus?.verificationUri || ""));
  }
  const authCancel = el("twitch-auth-cancel");
  const authStart = el("twitch-auth-start");
  if (authCancel) {
    authCancel.disabled = twitchAuthStatus?.state !== "pending";
  }
  if (authStart) {
    authStart.disabled = isSavingSettings;
    authStart.textContent = twitchAuthStatus?.state === "pending" ? "Restart Twitch login" : "Connect bot with Twitch";
  }
  if (twitchAuthStatus?.state === "success" && lastTwitchAuthState !== "success") {
    void loadSettings().catch(() => {
    });
  }
  lastTwitchAuthState = twitchAuthStatus?.state || "";
  const startWithWindowsToggle = el("start-with-windows-toggle");
  const startWithWindowsCopy = el("start-with-windows-copy");
  const startWithWindowsNote = el("start-with-windows-note");
  if (startWithWindowsToggle instanceof HTMLInputElement) {
    startWithWindowsToggle.disabled = isSavingSettings || desktopIntegration?.supported !== true;
  }
  if (startWithWindowsCopy) {
    startWithWindowsCopy.textContent = desktopIntegration?.supported === true ? "Launch the desktop app automatically when you sign in to Windows." : desktopIntegration?.reason || "Only available in the packaged Windows desktop app.";
  }
  if (startWithWindowsNote) {
    startWithWindowsNote.textContent = desktopIntegration?.supported === true ? desktopIntegration.enabled === true ? "Windows will launch the desktop app automatically at sign-in." : "Disabled. Turn this on and click Save changes below to register the app with Windows startup." : "";
  }
  applyRequestPolicyState();
  applyGuiPlayerState();
}
function guiPlayerStatusText(isEnabled) {
  return isEnabled ? "Active. The desktop app is hosting the same player view locally, even if OBS is closed." : "Inactive. Activate it to play inside the desktop app without OBS.";
}
function applyGuiPlayerState() {
  const toggleButton = el("overview-gui-player-toggle");
  const statusText = el("overview-gui-player-status");
  const frameWrap = el("overview-player-frame-wrap");
  const frame = el("overview-player-frame");
  const volumeSlider = el("overview-gui-player-volume");
  const volumeValue = el("overview-gui-player-volume-value");
  const runtimeOverlayUrl = settingsPayload?.runtime?.overlayUrl || "";
  const isEnabled = settingsPayload?.settings?.guiPlayerEnabled === true;
  const desiredFrameUrl = runtimeOverlayUrl ? `${runtimeOverlayUrl}${runtimeOverlayUrl.includes("?") ? "&" : "?"}embedded=desktop` : "";
  if (toggleButton) {
    toggleButton.disabled = isGuiPlayerSaving || isGuiPlayerVolumeSaving;
    toggleButton.textContent = isEnabled ? "Deactivate GUI player" : "Activate GUI player";
  }
  if (statusText) {
    statusText.textContent = guiPlayerStatusText(isEnabled);
  }
  if (volumeSlider instanceof HTMLInputElement) {
    volumeSlider.disabled = !isEnabled;
    volumeSlider.value = String(guiPlayerVolume);
  }
  if (volumeValue) {
    volumeValue.textContent = `${guiPlayerVolume}%`;
  }
  if (frameWrap) {
    frameWrap.hidden = !isEnabled;
  }
  if (!frame) {
    return;
  }
  const currentFrameUrl = frame.getAttribute("src") || "";
  if (isEnabled && desiredFrameUrl) {
    if (currentFrameUrl !== desiredFrameUrl) {
      frame.setAttribute("src", desiredFrameUrl);
    } else {
      syncGuiPlayerFrameVolume();
    }
  } else if (currentFrameUrl) {
    frame.setAttribute("src", "about:blank");
  }
}
function postGuiPlayerMessage(payload) {
  const frame = el("overview-player-frame");
  const targetWindow = frame?.contentWindow;
  if (!targetWindow) {
    return;
  }
  targetWindow.postMessage(payload, window.location.origin);
}
function syncGuiPlayerFrameVolume() {
  if (settingsPayload?.settings?.guiPlayerEnabled !== true) {
    return;
  }
  postGuiPlayerMessage({
    type: "gui-player:set-volume",
    volume: guiPlayerVolume
  });
}
async function persistGuiPlayerVolume() {
  if (!settingsPayload) {
    return;
  }
  const normalizedVolume = Math.min(100, Math.max(0, Number.parseInt(String(guiPlayerVolume ?? 100), 10) || 100));
  if (settingsPayload.settings.guiPlayerVolume === normalizedVolume) {
    return;
  }
  isGuiPlayerVolumeSaving = true;
  applyGuiPlayerState();
  try {
    settingsPayload = await persistSettings({
      guiPlayerVolume: normalizedVolume
    });
    availableThemes = Array.isArray(settingsPayload.themeOptions) ? settingsPayload.themeOptions : [];
    lastSavedTheme = settingsPayload.settings.theme || lastSavedTheme;
    guiPlayerVolume = Number.isFinite(settingsPayload.settings.guiPlayerVolume) ? settingsPayload.settings.guiPlayerVolume : normalizedVolume;
    applySettingsPayload();
  } catch (error) {
    setOverviewFeedback(error?.message || "Could not save the GUI player volume.", "error");
  } finally {
    isGuiPlayerVolumeSaving = false;
    applyGuiPlayerState();
  }
}
function scheduleGuiPlayerVolumeSave() {
  if (guiPlayerVolumeSaveTimer) {
    window.clearTimeout(guiPlayerVolumeSaveTimer);
  }
  guiPlayerVolumeSaveTimer = window.setTimeout(() => {
    guiPlayerVolumeSaveTimer = null;
    void persistGuiPlayerVolume();
  }, 180);
}
function describeRequester(track) {
  if (track?.origin === "radio") {
    return "Automatic radio track";
  }
  const requester = track?.requestedBy?.displayName || track?.requestedBy?.username;
  return requester ? `Requested by ${requester}` : "Fallback playlist track";
}
function playbackPillState(playbackStatus) {
  if (playbackStatus === "playing") {
    return {
      className: "status-pill status-pill--ok",
      text: "Playing"
    };
  }
  if (playbackStatus === "paused") {
    return {
      className: "status-pill status-pill--warn",
      text: "Paused"
    };
  }
  if (playbackStatus === "stopped") {
    return {
      className: "status-pill status-pill--accent",
      text: "Stopped"
    };
  }
  return {
    className: "status-pill status-pill--idle",
    text: "Idle"
  };
}
function describePlaybackMeta({ currentTrack, stoppedTrack, playbackStatus, queueLength }) {
  if (currentTrack) {
    const requesterText = describeRequester(currentTrack);
    return playbackStatus === "paused" ? `${requesterText} \u2022 Paused` : requesterText;
  }
  if (stoppedTrack) {
    return "Playback stopped. Press play to restart this track.";
  }
  if (queueLength > 0) {
    return "Queue is ready. Press play to start the next track.";
  }
  return "Queue is empty. Fallback playlist will play automatically.";
}
function renderFullQueue(queue) {
  const tableBody = el("queue-table-body");
  const emptyState = el("queue-empty-state");
  const clearButton = el("queue-clear-button");
  if (clearButton) {
    clearButton.disabled = queueActionTrackId === "__clear__" || queue.length === 0;
  }
  if (emptyState) {
    emptyState.hidden = queue.length > 0;
  }
  if (!tableBody) {
    return;
  }
  tableBody.innerHTML = "";
  queue.forEach((track, index) => {
    const requester = track.origin === "radio" ? "radio" : track.requestedBy?.displayName || track.requestedBy?.username || "playlist";
    const durationLabel = Number.isFinite(track.durationSeconds) && track.durationSeconds > 0 ? formatDuration(track.durationSeconds) : "";
    const row = document.createElement("tr");
    const isBusy = queueActionTrackId === track.id;
    const trackId = htmlEscape(track.id);
    const title = htmlEscape(track.title);
    row.innerHTML = `
      <td class="data-table__index">${index + 1}</td>
      <td>
        <strong>${title}</strong>
        ${durationLabel ? `<div class="command-table__description">${htmlEscape(durationLabel)}</div>` : ""}
      </td>
      <td>${htmlEscape(requester)}</td>
      <td><span class="provider-chip">${htmlEscape(track.provider)}</span></td>
      <td class="data-table__actions">
        <div class="row-actions">
          <button class="icon-button" type="button" data-queue-action="move-up" data-queue-track-id="${trackId}" aria-label="Move ${title} up" title="Move up" ${isBusy || index === 0 ? "disabled" : ""}>\u2191</button>
          <button class="icon-button" type="button" data-queue-action="move-down" data-queue-track-id="${trackId}" aria-label="Move ${title} down" title="Move down" ${isBusy || index === queue.length - 1 ? "disabled" : ""}>\u2193</button>
          <button class="small-button" type="button" data-queue-action="promote" data-queue-track-id="${trackId}" aria-label="Move ${title} to top" ${isBusy || index === 0 ? "disabled" : ""}>Top</button>
          <button class="small-button small-button--danger" type="button" data-queue-action="remove" data-queue-track-id="${trackId}" aria-label="Remove ${title}" ${isBusy ? "disabled" : ""}>Remove</button>
        </div>
      </td>
    `;
    tableBody.appendChild(row);
  });
}
async function moveQueueTrack(trackId, direction) {
  if (!trackId) {
    return;
  }
  queueActionTrackId = trackId;
  applyPlaybackState();
  setQueueFeedback(direction === "down" ? "Moving track down..." : "Moving track up...");
  try {
    const payload = await fetchJson(`/api/queue/${encodeURIComponent(trackId)}/move`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        direction
      })
    });
    playbackState = payload.state;
    applyPlaybackState();
    setQueueFeedback(
      `Moved ${payload.track.title} ${direction === "down" ? "down" : "up"} in the queue.`,
      "success"
    );
  } catch (error) {
    setQueueFeedback(error?.message || "Could not move the queued track.", "error");
  } finally {
    queueActionTrackId = "";
    applyPlaybackState();
  }
}
function historyStatusLabel(status) {
  if (status === "skipped") {
    return "Skipped";
  }
  if (status === "deleted") {
    return "Deleted";
  }
  if (status === "error") {
    return "Error";
  }
  if (status === "stopped") {
    return "Stopped";
  }
  return "Finished";
}
function historyStatusTone(status) {
  if (status === "error") {
    return "status-pill--error";
  }
  if (status === "skipped" || status === "deleted") {
    return "status-pill--warn";
  }
  return status === "stopped" ? "status-pill--idle" : "status-pill--ok";
}
function renderHistory(history) {
  const historyList = el("history-list");
  if (!historyList) {
    return;
  }
  historyList.innerHTML = "";
  if (!history.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "Playback history will appear here after songs finish, stop, or skip.";
    historyList.appendChild(emptyState);
    return;
  }
  history.slice(0, 12).forEach((entry) => {
    const item = document.createElement("article");
    item.className = "history-item";
    const requester = entry.track?.requestedBy?.displayName || entry.track?.requestedBy?.username || "playlist";
    item.innerHTML = `
      <div class="history-item__main">
        <strong>${htmlEscape(entry.track?.title || "Unknown track")}</strong>
        <div class="command-table__description">${htmlEscape(requester)} \u2022 ${htmlEscape(entry.track?.provider || "unknown")}</div>
      </div>
      <div class="history-item__meta">
        <span class="status-pill ${historyStatusTone(entry.status)}">${htmlEscape(historyStatusLabel(entry.status))}</span>
        <time class="history-item__time" datetime="${htmlEscape(entry.completedAt || "")}">${htmlEscape(new Date(entry.completedAt || Date.now()).toLocaleString())}</time>
      </div>
    `;
    historyList.appendChild(item);
  });
}
function adminEventLabel(action) {
  if (action === "queue_remove") {
    return "Removed from queue";
  }
  if (action === "queue_remove_own") {
    return "Removed own request";
  }
  if (action === "queue_move") {
    return "Moved in queue";
  }
  if (action === "queue_promote") {
    return "Moved to top";
  }
  if (action === "queue_clear") {
    return "Cleared queue";
  }
  if (action === "skip_current") {
    return "Skipped track";
  }
  if (action === "delete_current") {
    return "Deleted track";
  }
  if (action === "save_current") {
    return "Saved track";
  }
  if (action === "stop_playback") {
    return "Stopped playback";
  }
  if (action === "restart_stopped") {
    return "Restarted stopped track";
  }
  if (action === "open_requests") {
    return "Opened requests";
  }
  if (action === "close_requests") {
    return "Closed requests";
  }
  return action;
}
function renderAdminEvents(adminEvents) {
  const eventList = el("admin-event-list");
  if (!eventList) {
    return;
  }
  eventList.innerHTML = "";
  if (!adminEvents.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "Moderator and dashboard actions will appear here.";
    eventList.appendChild(emptyState);
    return;
  }
  adminEvents.slice(0, 12).forEach((entry) => {
    const item = document.createElement("article");
    item.className = "history-item";
    const trackTitle = entry.track?.title ? ` \u2022 ${entry.track.title}` : "";
    const detailText = entry.details?.clearedCount ? ` \u2022 ${entry.details.clearedCount} cleared` : entry.details?.fromIndex && entry.details?.toIndex ? ` \u2022 ${entry.details.fromIndex} -> ${entry.details.toIndex}` : "";
    item.innerHTML = `
      <div class="history-item__main">
        <strong>${htmlEscape(adminEventLabel(entry.action))}</strong>
        <div class="command-table__description">${htmlEscape(entry.triggeredBy || "unknown")}${htmlEscape(trackTitle)}${htmlEscape(detailText)}</div>
      </div>
      <div class="history-item__meta">
        <time class="history-item__time" datetime="${htmlEscape(entry.createdAt || "")}">${htmlEscape(new Date(entry.createdAt || Date.now()).toLocaleString())}</time>
      </div>
    `;
    eventList.appendChild(item);
  });
}
async function loadPlaybackState() {
  playbackState = await fetchJson("/api/state");
  applyPlaybackState();
}
function applyPlaybackState() {
  const currentTrack = playbackState?.currentTrack;
  const stoppedTrack = playbackState?.stoppedTrack;
  const queue = playbackState?.queue || [];
  const history = playbackState?.history || [];
  const adminEvents = playbackState?.adminEvents || [];
  const playbackStatus = playbackState?.playbackStatus || "idle";
  const visibleTrack = currentTrack || stoppedTrack;
  const playbackPill = el("playback-state-pill");
  const pillState = playbackPillState(playbackStatus);
  setText("current-track-title", visibleTrack?.title || "Waiting for a track");
  setText("current-track-meta", describePlaybackMeta({
    currentTrack,
    stoppedTrack,
    playbackStatus,
    queueLength: queue.length
  }));
  syncOverviewProgress(visibleTrack, playbackStatus);
  if (playbackPill) {
    playbackPill.className = pillState.className;
    playbackPill.textContent = pillState.text;
  }
  const playPauseButton = el("overview-play-pause");
  const stopButton = el("overview-stop");
  const nextButton = el("overview-next");
  const saveButton = el("overview-save");
  const queueButton = el("overview-queue-button");
  const searchButton = el("overview-search-button");
  const restartStoppedButton = el("playback-restart-stopped");
  if (playPauseButton) {
    playPauseButton.disabled = isPlaybackCommandPending || isAutoDjActivationPending;
    playPauseButton.textContent = playbackStatus === "playing" ? "Pause" : autoDjStatus?.activation?.desired ? "Play normally" : "Play";
  }
  const playbackOwnerHint = el("overview-playback-owner");
  if (playbackOwnerHint) {
    playbackOwnerHint.hidden = !autoDjStatus?.configured;
    playbackOwnerHint.textContent = autoDjStatus?.activation?.desired ? "Play normally pauses AutoDJ, then starts your normal playlist or queued tracks. Your AutoDJ connection stays saved." : "Normal playback is selected. Resume AutoDJ from the AutoDJ tab to switch back.";
  }
  if (stopButton) {
    stopButton.disabled = isPlaybackCommandPending || playbackStatus === "idle";
  }
  if (nextButton) {
    nextButton.disabled = isPlaybackCommandPending;
  }
  if (saveButton) {
    saveButton.disabled = isPlaybackCommandPending || !currentTrack || currentTrack.isSaved;
    saveButton.textContent = currentTrack?.isSaved ? "Saved" : "Save";
  }
  if (queueButton) {
    queueButton.disabled = isQueueSubmitting || isOverviewSearchPending;
  }
  if (searchButton) {
    searchButton.disabled = isQueueSubmitting || isOverviewSearchPending;
  }
  if (restartStoppedButton) {
    restartStoppedButton.hidden = !stoppedTrack;
    restartStoppedButton.disabled = isPlaybackCommandPending || !stoppedTrack;
  }
  const guiPlayerToggle = el("overview-gui-player-toggle");
  if (guiPlayerToggle) {
    guiPlayerToggle.disabled = isGuiPlayerSaving || isGuiPlayerVolumeSaving;
  }
  const queueList = el("queue-preview");
  if (!queueList) {
    return;
  }
  queueList.innerHTML = "";
  if (!queue.length) {
    const item = document.createElement("li");
    item.className = "queue-preview__empty";
    item.textContent = "No queued requests yet.";
    queueList.appendChild(item);
  } else {
    queue.slice(0, 5).forEach((track) => {
      const requester = track.origin === "radio" ? "radio" : track.requestedBy?.displayName || track.requestedBy?.username || "playlist";
      const durationLabel = Number.isFinite(track.durationSeconds) && track.durationSeconds > 0 ? ` \u2022 ${formatDuration(track.durationSeconds)}` : "";
      const item = document.createElement("li");
      item.innerHTML = `<span class="queue-preview__title">${htmlEscape(track.title)}</span><span class="queue-preview__meta">${htmlEscape(`${requester}${durationLabel}`)}</span>`;
      queueList.appendChild(item);
    });
    if (queue.length > 5) {
      const more = document.createElement("li");
      more.className = "queue-preview__more";
      more.textContent = `+${queue.length - 5} more in the queue`;
      queueList.appendChild(more);
    }
  }
  renderFullQueue(queue);
  renderHistory(history);
  renderAdminEvents(adminEvents);
  renderOverviewSearchResults();
}
function syncOverviewProgress(track, playbackStatus) {
  overviewProgressTrackId = track?.id || "";
  overviewProgressElapsedSeconds = Number.isFinite(track?.elapsedSeconds) ? Math.max(track.elapsedSeconds, 0) : 0;
  overviewProgressDurationSeconds = Number.isFinite(track?.durationSeconds) ? Math.max(track.durationSeconds, 0) : 0;
  overviewProgressLastSyncAt = Date.now();
  overviewProgressIsRunning = playbackStatus === "playing" && Boolean(track?.id);
  renderOverviewProgress();
}
function renderOverviewProgress() {
  const progress = el("overview-progress");
  const fill = el("overview-progress-fill");
  if (!progress || !fill) {
    return;
  }
  if (!overviewProgressTrackId) {
    progress.hidden = true;
    fill.style.width = "0%";
    setText("overview-progress-elapsed", "0:00");
    setText("overview-progress-duration", "0:00");
    return;
  }
  progress.hidden = false;
  let elapsedSeconds = overviewProgressElapsedSeconds;
  if (overviewProgressIsRunning && overviewProgressLastSyncAt > 0) {
    elapsedSeconds += (Date.now() - overviewProgressLastSyncAt) / 1e3;
  }
  if (overviewProgressDurationSeconds > 0) {
    elapsedSeconds = Math.min(elapsedSeconds, overviewProgressDurationSeconds);
  }
  const safeElapsedSeconds = Math.max(elapsedSeconds, 0);
  const fillPercent = overviewProgressDurationSeconds > 0 ? Math.max(0, Math.min(100, safeElapsedSeconds / overviewProgressDurationSeconds * 100)) : 0;
  fill.style.width = `${fillPercent}%`;
  setText("overview-progress-elapsed", formatDuration(safeElapsedSeconds));
  setText(
    "overview-progress-duration",
    overviewProgressDurationSeconds > 0 ? formatDuration(overviewProgressDurationSeconds) : "--:--"
  );
}
function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(Number.parseInt(String(totalSeconds), 10) || 0, 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor(safeSeconds % 3600 / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
function renderOverviewSearchResults() {
  const searchResults = el("overview-search-results");
  if (!searchResults) {
    return;
  }
  searchResults.innerHTML = "";
  searchResults.hidden = overviewSearchResults.length === 0;
  overviewSearchResults.forEach((track, index) => {
    const item = document.createElement("article");
    item.className = "history-item";
    const sourceLabel = track.sourceName || track.requestedFromName || track.provider || "unknown";
    item.innerHTML = `
      <div class="history-item__main">
        <strong>${htmlEscape(track.title || "Unknown track")}</strong>
        <div class="command-table__description">${htmlEscape(sourceLabel)}${track.durationSeconds ? ` \u2022 ${htmlEscape(formatDuration(track.durationSeconds))}` : ""}</div>
      </div>
      <div class="history-item__meta">
        <span class="provider-chip">${htmlEscape(track.provider || "unknown")}</span>
        <button class="small-button" type="button" data-overview-search-add-index="${index}" aria-label="Add ${htmlEscape(track.title || "Unknown track")} to queue">Add</button>
      </div>
    `;
    searchResults.appendChild(item);
  });
}
function formatLibraryHealthReason(reason) {
  if (!reason) {
    return "Playback failed";
  }
  if (reason === "metadata_refresh_failed") {
    return "Metadata refresh failed";
  }
  if (reason === "youtube_startup_timeout") {
    return "YouTube startup timed out";
  }
  if (reason === "soundcloud_load_timeout") {
    return "SoundCloud load timed out";
  }
  if (reason === "soundcloud_widget_error") {
    return "SoundCloud widget error";
  }
  if (reason === "invalid_youtube_url") {
    return "Invalid YouTube URL";
  }
  if (reason === "suno_audio_unavailable") {
    return "Suno audio playback is unavailable";
  }
  if (reason === "suno_missing_audio_url") {
    return "Suno track is missing a playable audio stream";
  }
  if (reason === "suno_audio_error") {
    return "Suno audio playback failed";
  }
  return reason.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
function formatLibraryFailureSummary(health) {
  const consecutive = Number.parseInt(String(health?.consecutiveFailureCount ?? 0), 10) || 0;
  const total = Number.parseInt(String(health?.failureCount ?? 0), 10) || 0;
  if (consecutive > 0) {
    return `${consecutive} recent failure${consecutive === 1 ? "" : "s"} \u2022 ${total} total`;
  }
  return `${total} failure${total === 1 ? "" : "s"} recorded`;
}
function renderPlaylistReview() {
  const reviewList = el("playlist-review-list");
  const flaggedCount = playlistReviewPayload?.summary?.flaggedCount || 0;
  const totalFailures = playlistReviewPayload?.summary?.totalFailureCount || 0;
  setText("playlist-review-flagged-count", `${flaggedCount} flagged`);
  if (el("playlist-review-flagged-count")) {
    el("playlist-review-flagged-count").className = `status-pill ${flaggedCount > 0 ? "status-pill--warn" : "status-pill--idle"}`;
  }
  setText("playlist-review-total-failures", `${totalFailures} failure${totalFailures === 1 ? "" : "s"}`);
  if (!reviewList) {
    return;
  }
  reviewList.innerHTML = "";
  if (!playlistReviewPayload?.items?.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "No library tracks are currently flagged for review.";
    reviewList.appendChild(emptyState);
    return;
  }
  playlistReviewPayload.items.forEach((track) => {
    const item = document.createElement("article");
    item.className = "history-item library-review-item";
    const health = track.health || {};
    const lastFailureText = health.lastFailureAt ? new Date(health.lastFailureAt).toLocaleString() : "Unknown time";
    const failureMessage = health.lastFailureMessage ? `<div class="command-table__description command-table__description--warn">${htmlEscape(health.lastFailureMessage)}</div>` : "";
    item.innerHTML = `
      <div class="history-item__main">
        <div class="library-track-heading">
          <strong>${htmlEscape(track.title)}</strong>
          <span class="status-pill status-pill--warn library-flag-pill">Needs review</span>
        </div>
        <div class="command-table__description">${htmlEscape(track.provider)} \u2022 ${htmlEscape(formatLibraryFailureSummary(health))} \u2022 ${htmlEscape(formatLibraryHealthReason(health.lastFailureReason))}</div>
        <div class="command-table__description">${htmlEscape(track.key)}</div>
        ${failureMessage}
      </div>
      <div class="history-item__meta library-review-meta">
        <time class="history-item__time" datetime="${htmlEscape(health.lastFailureAt || "")}">${htmlEscape(lastFailureText)}</time>
        <div class="row-actions library-review-actions">
          <button class="small-button" type="button" data-playlist-review-action="queue" data-playlist-review-key="${htmlEscape(track.key)}" aria-label="Queue ${htmlEscape(track.title)}">Queue</button>
          <button class="small-button" type="button" data-playlist-review-action="refresh" data-playlist-review-key="${htmlEscape(track.key)}" aria-label="Refresh metadata for ${htmlEscape(track.title)}">Refresh</button>
          <button class="small-button small-button--danger" type="button" data-playlist-review-action="delete" data-playlist-review-key="${htmlEscape(track.key)}" aria-label="Delete ${htmlEscape(track.title)}">Delete</button>
        </div>
      </div>
    `;
    reviewList.appendChild(item);
  });
}
async function loadPlaylist() {
  const params = new URLSearchParams({
    page: String(playlistPage),
    pageSize: "100",
    sortBy: playlistSortBy
  });
  if (playlistQuery) {
    params.set("q", playlistQuery);
  }
  const [playlistResponse, reviewResponse] = await Promise.all([
    fetchJson(`/api/playlist/tracks?${params.toString()}`),
    fetchJson("/api/playlist/review?limit=8")
  ]);
  playlistPayload = playlistResponse;
  playlistReviewPayload = reviewResponse;
  playlistTotalPages = playlistPayload.totalPages || 1;
  playlistPage = playlistPayload.page || 1;
  applyPlaylistState();
}
function applyPlaylistState() {
  if (!playlistPayload) {
    return;
  }
  setText("playlist-count", `${(playlistPayload.total || 0).toLocaleString()} tracks`);
  setText("playlist-page-info", `Page ${playlistPayload.page || 1} of ${playlistPayload.totalPages || 1}`);
  const prevButton = el("playlist-prev-page");
  const nextButton = el("playlist-next-page");
  const bulkQueueButton = el("playlist-bulk-queue-button");
  const exportSelectedButton = el("playlist-export-selected-button");
  const bulkDeleteButton = el("playlist-bulk-delete-button");
  const selectPageCheckbox = el("playlist-select-page");
  const sortSelect = el("playlist-sort-select");
  const tableBody = el("playlist-table-body");
  const emptyState = el("playlist-empty-state");
  if (prevButton) {
    prevButton.disabled = (playlistPayload.page || 1) <= 1;
  }
  if (nextButton) {
    nextButton.disabled = (playlistPayload.page || 1) >= (playlistPayload.totalPages || 1);
  }
  if (bulkQueueButton) {
    bulkQueueButton.disabled = playlistSelectedKeys.size === 0;
  }
  if (exportSelectedButton) {
    exportSelectedButton.disabled = playlistSelectedKeys.size === 0;
  }
  if (bulkDeleteButton) {
    bulkDeleteButton.disabled = playlistSelectedKeys.size === 0;
  }
  if (sortSelect instanceof HTMLSelectElement) {
    sortSelect.value = playlistPayload.sortBy || playlistSortBy;
  }
  if (selectPageCheckbox instanceof HTMLInputElement) {
    const items = playlistPayload.items || [];
    const selectedCount = items.filter((track) => playlistSelectedKeys.has(track.key)).length;
    selectPageCheckbox.checked = items.length > 0 && selectedCount === items.length;
    selectPageCheckbox.indeterminate = selectedCount > 0 && selectedCount < items.length;
  }
  if (emptyState) {
    emptyState.hidden = (playlistPayload.items || []).length > 0;
    emptyState.textContent = playlistQuery ? "No playlist tracks matched this search." : "Your library is empty. Add a track or import a CSV to get started.";
  }
  if (!tableBody) {
    return;
  }
  renderPlaylistReview();
  tableBody.innerHTML = "";
  (playlistPayload.items || []).forEach((track) => {
    const isFlagged = track.health?.flagged === true;
    const healthSummary = isFlagged ? `<div class="command-table__description command-table__description--warn">${htmlEscape(formatLibraryFailureSummary(track.health))} \u2022 ${htmlEscape(formatLibraryHealthReason(track.health?.lastFailureReason))}</div>` : "";
    const row = document.createElement("tr");
    const title = htmlEscape(track.title);
    row.innerHTML = `
      <td class="data-table__checkbox">
        <input type="checkbox" data-playlist-select-key="${htmlEscape(track.key)}" aria-label="Select ${title}" ${playlistSelectedKeys.has(track.key) ? "checked" : ""} />
      </td>
      <td>
        <div class="library-track-heading">
          <strong>${title}</strong>
          ${isFlagged ? '<span class="status-pill status-pill--warn library-flag-pill">Flagged</span>' : ""}
        </div>
        ${healthSummary}
      </td>
      <td><span class="provider-chip">${htmlEscape(track.provider)}</span></td>
      <td><a class="playlist-link" href="${htmlEscape(track.url)}" target="_blank" rel="noopener noreferrer">${htmlEscape(track.url)}</a></td>
      <td class="data-table__actions">
        <div class="row-actions">
          <button class="small-button" type="button" data-playlist-edit-key="${htmlEscape(track.key)}" data-playlist-title="${title}" aria-label="Edit title of ${title}">Edit</button>
          <button class="small-button" type="button" data-playlist-refresh-key="${htmlEscape(track.key)}" aria-label="Refresh metadata for ${title}">Refresh</button>
          <button class="small-button small-button--danger" type="button" data-playlist-delete-key="${htmlEscape(track.key)}" aria-label="Delete ${title}">Delete</button>
        </div>
      </td>
    `;
    tableBody.appendChild(row);
  });
  const searchInput = el("playlist-search-input");
  if (searchInput && searchInput.value !== playlistQuery) {
    searchInput.value = playlistQuery;
  }
}
async function bulkQueuePlaylistTracks() {
  if (playlistSelectedKeys.size === 0) {
    return;
  }
  try {
    const payload = await fetchJson("/api/playlist/bulk-queue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        trackKeys: Array.from(playlistSelectedKeys)
      })
    });
    playbackState = payload.state;
    applyPlaybackState();
    setPlaylistFeedback(
      `Queued ${payload.result.queuedCount} track${payload.result.queuedCount === 1 ? "" : "s"} from the library.`,
      "success"
    );
  } catch (error) {
    setPlaylistFeedback(error?.message || "Could not queue the selected playlist tracks.", "error");
  }
}
async function startFreshLibrary() {
  if (playlistResetPending || !window.confirm(
    "Start a fresh library? This removes ALL saved fallback tracks and their review flags, including tracks outside the current search or page.\n\nCurrent playback, queued requests, history, and settings are kept. Export CSV first if you want a backup.\n\nClear the library?"
  )) {
    return;
  }
  playlistResetPending = true;
  const button = el("playlist-fresh-button");
  if (button) {
    button.disabled = true;
    button.textContent = "Starting fresh\u2026";
  }
  try {
    await fetchJson("/api/playlist/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "replace", csvText: "Link,Title\n" })
    });
    clearTimeout(playlistSearchDebounceTimer);
    playlistSelectedKeys = /* @__PURE__ */ new Set();
    playlistQuery = "";
    playlistPage = 1;
    await loadPlaylist();
    setPlaylistFeedback("Fresh library started. Add tracks or import a CSV to get started.", "success");
  } catch (error) {
    setPlaylistFeedback(error?.message || "Could not start a fresh library.", "error");
  } finally {
    playlistResetPending = false;
    if (button) {
      button.disabled = false;
      button.textContent = "Start fresh library";
    }
  }
}
async function bulkDeletePlaylistTracks() {
  if (playlistSelectedKeys.size === 0 || !window.confirm("Delete the selected tracks from the fallback playlist?")) {
    return;
  }
  try {
    const payload = await fetchJson("/api/playlist/bulk-delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        trackKeys: Array.from(playlistSelectedKeys)
      })
    });
    playlistSelectedKeys = /* @__PURE__ */ new Set();
    await loadPlaylist();
    setPlaylistFeedback(
      `Deleted ${payload.result.removedCount} track${payload.result.removedCount === 1 ? "" : "s"} from the library.`,
      "success"
    );
  } catch (error) {
    setPlaylistFeedback(error?.message || "Could not delete the selected playlist tracks.", "error");
  }
}
async function queueSinglePlaylistTrack(trackKey) {
  if (!trackKey) {
    return;
  }
  try {
    const payload = await fetchJson("/api/playlist/bulk-queue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        trackKeys: [trackKey]
      })
    });
    playbackState = payload.state;
    applyPlaybackState();
    await loadPlaylist();
    if (payload.result.queuedCount > 0) {
      setPlaylistFeedback("Queued the flagged library track for another playback attempt.", "success");
    } else {
      setPlaylistFeedback("That track is already queued or currently playing.", "warning");
    }
  } catch (error) {
    setPlaylistFeedback(error?.message || "Could not queue the library track.", "error");
  }
}
function setYouTubeApiFeedback(message, tone = "") {
  const feedback = el("youtube-api-feedback");
  feedback.textContent = message;
  feedback.className = `feedback${tone ? ` is-${tone}` : ""}`;
}
function resetYouTubeApiCheck() {
  youtubeApiCheckController?.abort();
  youtubeApiCheckController = null;
  const button = el("youtube-api-check");
  button.disabled = false;
  button.textContent = "Check API key";
  setYouTubeApiFeedback("Not checked. Click Check API key to test access.");
}
async function checkEnteredYouTubeApiKey() {
  if (youtubeApiCheckController) return;
  const key = el("youtubeApiKey").value.trim();
  const controller = new AbortController();
  youtubeApiCheckController = controller;
  const button = el("youtube-api-check");
  button.disabled = true;
  button.textContent = "Checking...";
  setYouTubeApiFeedback("Checking access from the Music Control Center server...");
  const timeout = window.setTimeout(() => controller.abort(), 15e3);
  try {
    const check = await fetchJson("/api/settings/youtube/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ youtubeApiKey: key }),
      signal: controller.signal
    });
    if (youtubeApiCheckController !== controller) return;
    const tone = check.status === "valid" ? "success" : ["missing", "quota_exceeded", "rate_limited", "timeout", "network_error", "service_error"].includes(check.status) ? "warning" : "error";
    setYouTubeApiFeedback(check.message, tone);
  } catch {
    if (youtubeApiCheckController !== controller) return;
    setYouTubeApiFeedback("Could not complete the check. Make sure Music Control Center is reachable and try again; the key's validity is unknown.", "warning");
  } finally {
    window.clearTimeout(timeout);
    if (youtubeApiCheckController === controller) {
      youtubeApiCheckController = null;
      button.disabled = false;
      button.textContent = "Check API key";
    }
  }
}
async function persistSettings(payload) {
  const submittedDraft = captureSettingsDraft();
  const result = await fetchJson("/api/settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  for (const [id, entry] of Object.entries(submittedDraft)) {
    if (savedSettingsDraft && Object.hasOwn(payload, entry.setting)) savedSettingsDraft[id] = entry;
  }
  return result;
}
async function saveSettings(event) {
  event?.preventDefault?.();
  if (!settingsPayload || isSavingSettings || isRequestPolicyAutosaveSaving) return;
  const pending = pendingSettingsDraft();
  if (Object.keys(pending).length === 0) return;
  const invalid = settingsControls().find(({ id, element }) => pending[id] && !element.disabled && !element.checkValidity());
  if (invalid) {
    activeTab = invalid.element.closest(".atlas-view").id.replace("tab-", "");
    applyTabState();
    invalid.element.reportValidity();
    settingsSaveError = "Check the highlighted field, then save again.";
    updateSettingsSaveState();
    return;
  }
  const allSettings = collectSettingsPayload();
  const changedSettings = new Set(Object.values(pending).map(({ setting }) => setting));
  const payload = Object.fromEntries(Object.entries(allSettings).filter(([setting]) => changedSettings.has(setting)));
  settingsSaveError = "";
  settingsSaveNotice = "";
  clearRequestPolicyAutosaveTimer();
  hasPendingRequestPolicyAutosave = false;
  isSavingSettings = true;
  updateSettingsSaveState();
  const saveButton = el("save-button");
  const themeSelect = el("theme-select");
  const overlayScaleSlider = el("overlay-scale-slider");
  if (saveButton) {
    saveButton.disabled = true;
  }
  if (themeSelect) {
    themeSelect.disabled = true;
  }
  if (overlayScaleSlider) {
    overlayScaleSlider.disabled = true;
  }
  applyRequestAutosaveState();
  setFeedback("Saving settings...");
  try {
    settingsPayload = await persistSettings(payload);
    availableThemes = Array.isArray(settingsPayload.themeOptions) ? settingsPayload.themeOptions : [];
    lastSavedTheme = settingsPayload.settings.theme || "aurora";
    lastSavedOverlayScalePercent = normalizeOverlayScalePercent(
      settingsPayload.settings.overlayScalePercent
    );
    chatSuppressedCategories = Array.isArray(settingsPayload.settings.chatSuppressedCategories) ? [...settingsPayload.settings.chatSuppressedCategories] : [];
    playbackSuppressedCategories = Array.isArray(settingsPayload.settings.playbackSuppressedCategories) ? [...settingsPayload.settings.playbackSuppressedCategories] : [];
    guiPlayerVolume = Number.isFinite(settingsPayload.settings.guiPlayerVolume) ? settingsPayload.settings.guiPlayerVolume : guiPlayerVolume;
    applySettingsPayload();
    if (settingsPayload.saveSummary?.restartRequired) {
      settingsSaveNotice = "Restart the app to switch to the new port.";
      setFeedback("Settings saved. Restart the app to switch to the new port.", "warning");
    } else if (settingsPayload.saveSummary?.botReconnected) {
      setFeedback("Settings saved and Twitch chat was reconnected.", "success");
    } else {
      setFeedback("Settings saved.", "success");
    }
  } catch (error) {
    settingsSaveError = error?.message || "Could not save settings. Your edits are still here; retry when ready.";
    setFeedback(error?.message || "Could not save settings.", "error");
  } finally {
    isSavingSettings = false;
    if (el("save-button")) {
      el("save-button").disabled = false;
    }
    if (el("theme-select")) {
      el("theme-select").disabled = false;
    }
    if (el("overlay-scale-slider")) {
      el("overlay-scale-slider").disabled = false;
    }
    applyYoutubeFallbackState();
    applyRequestAutosaveState();
    if (hasPendingRequestPolicyAutosave && getRequestPolicyAutosaveEnabled()) {
      hasPendingRequestPolicyAutosave = false;
      scheduleRequestPolicyAutosave(true);
    }
    updateSettingsSaveState();
  }
}
async function saveRequestPolicySection({
  requestPolicy = collectRequestPolicyPayload(),
  requestPolicyAutosaveEnabled = getRequestPolicyAutosaveEnabled(),
  reason = "manual"
} = {}) {
  clearRequestPolicyAutosaveTimer();
  hasPendingRequestPolicyAutosave = false;
  if (!settingsPayload) {
    return;
  }
  const savedRequestPolicy = settingsPayload.settings?.requestPolicy ?? getRequestPolicy();
  const savedAutosaveEnabled = settingsPayload.settings?.requestPolicyAutosaveEnabled === true;
  const requestPolicyChanged = !requestPoliciesEqual(requestPolicy, savedRequestPolicy);
  const autosaveSettingChanged = requestPolicyAutosaveEnabled !== savedAutosaveEnabled;
  if (!requestPolicyChanged && !autosaveSettingChanged) {
    if (reason === "toggle") {
      setRequestsFeedback(
        requestPolicyAutosaveEnabled ? "Request autosave is on. Request changes now save automatically." : "Request autosave is off. Use Save changes below to apply request changes.",
        "success"
      );
      applyRequestAutosaveState();
    }
    return;
  }
  if (isSavingSettings || isRequestPolicyAutosaveSaving) {
    hasPendingRequestPolicyAutosave = true;
    return;
  }
  isRequestPolicyAutosaveSaving = true;
  settingsSaveError = "";
  updateSettingsSaveState();
  applyRequestAutosaveState();
  if (reason === "autosave") {
    setRequestsFeedback("Saving request changes automatically...");
  } else if (reason === "toggle") {
    setRequestsFeedback(
      requestPolicyAutosaveEnabled ? "Turning request autosave on..." : "Turning request autosave off..."
    );
  } else {
    setRequestsFeedback("Saving request controls...");
  }
  const payload = {};
  if (requestPolicyChanged) {
    payload.requestPolicy = requestPolicy;
  }
  if (autosaveSettingChanged) {
    payload.requestPolicyAutosaveEnabled = requestPolicyAutosaveEnabled;
  }
  try {
    settingsPayload = await persistSettings(payload);
    availableThemes = Array.isArray(settingsPayload.themeOptions) ? settingsPayload.themeOptions : [];
    lastSavedTheme = settingsPayload.settings.theme || lastSavedTheme;
    chatSuppressedCategories = Array.isArray(settingsPayload.settings.chatSuppressedCategories) ? [...settingsPayload.settings.chatSuppressedCategories] : [];
    playbackSuppressedCategories = Array.isArray(settingsPayload.settings.playbackSuppressedCategories) ? [...settingsPayload.settings.playbackSuppressedCategories] : [];
    guiPlayerVolume = Number.isFinite(settingsPayload.settings.guiPlayerVolume) ? settingsPayload.settings.guiPlayerVolume : guiPlayerVolume;
    applySettingsPayload();
    if (reason === "autosave") {
      setRequestsFeedback("Request changes saved automatically.", "success");
    } else if (reason === "toggle") {
      setRequestsFeedback(
        requestPolicyAutosaveEnabled ? "Request autosave is on. Request changes now save automatically." : "Request autosave is off. Use Save changes below to apply request changes.",
        "success"
      );
    } else {
      setRequestsFeedback("Request controls saved.", "success");
    }
  } catch (error) {
    settingsSaveError = error?.message || "Could not save request controls. Your edits are still here.";
    setRequestsFeedback(error?.message || "Could not save request controls.", "error");
  } finally {
    isRequestPolicyAutosaveSaving = false;
    applyRequestAutosaveState();
    if (hasPendingRequestPolicyAutosave && getRequestPolicyAutosaveEnabled()) {
      hasPendingRequestPolicyAutosave = false;
      scheduleRequestPolicyAutosave(true);
    }
    updateSettingsSaveState();
  }
}
function scheduleRequestPolicyAutosave(immediate = false) {
  if (isHydratingForm || !settingsPayload || !getRequestPolicyAutosaveEnabled()) {
    return;
  }
  if (isSavingSettings || isRequestPolicyAutosaveSaving) {
    hasPendingRequestPolicyAutosave = true;
    return;
  }
  clearRequestPolicyAutosaveTimer();
  const nextRequestPolicy = collectRequestPolicyPayload();
  const savedRequestPolicy = settingsPayload.settings?.requestPolicy ?? getRequestPolicy();
  if (requestPoliciesEqual(nextRequestPolicy, savedRequestPolicy)) {
    setRequestsFeedback("Autosave is on.", "success");
    return;
  }
  setRequestsFeedback(immediate ? "Saving request changes automatically..." : "Autosave queued...");
  requestPolicyAutosaveTimer = window.setTimeout(() => {
    requestPolicyAutosaveTimer = null;
    void saveRequestPolicySection({
      requestPolicy: nextRequestPolicy,
      reason: "autosave"
    });
  }, immediate ? 0 : 500);
}
function toggleRequestPolicyAutosave() {
  if (!settingsPayload || isRequestPolicyAutosaveSaving) {
    return;
  }
  const nextValue = !getRequestPolicyAutosaveEnabled();
  void saveRequestPolicySection({
    requestPolicy: collectRequestPolicyPayload(),
    requestPolicyAutosaveEnabled: nextValue,
    reason: "toggle"
  });
}
async function saveThemeSelection(nextTheme) {
  if (!nextTheme || nextTheme === lastSavedTheme) {
    return;
  }
  try {
    settingsPayload = await persistSettings({
      theme: nextTheme
    });
    availableThemes = Array.isArray(settingsPayload.themeOptions) ? settingsPayload.themeOptions : [];
    lastSavedTheme = settingsPayload.settings.theme || nextTheme;
    guiPlayerVolume = Number.isFinite(settingsPayload.settings.guiPlayerVolume) ? settingsPayload.settings.guiPlayerVolume : guiPlayerVolume;
    applySettingsPayload();
    setFeedback("Overlay theme saved.", "success");
  } catch (error) {
    renderThemeOptions(lastSavedTheme);
    setFeedback(error?.message || "Could not save overlay theme.", "error");
  }
}
async function saveOverlayScaleSelection(nextScale) {
  const normalizedScale = normalizeOverlayScalePercent(nextScale);
  if (normalizedScale === lastSavedOverlayScalePercent) {
    renderOverlayScaleControl(lastSavedOverlayScalePercent);
    return;
  }
  try {
    settingsPayload = await persistSettings({
      overlayScalePercent: normalizedScale
    });
    availableThemes = Array.isArray(settingsPayload.themeOptions) ? settingsPayload.themeOptions : [];
    lastSavedTheme = settingsPayload.settings.theme || lastSavedTheme;
    lastSavedOverlayScalePercent = normalizeOverlayScalePercent(
      settingsPayload.settings.overlayScalePercent
    );
    guiPlayerVolume = Number.isFinite(settingsPayload.settings.guiPlayerVolume) ? settingsPayload.settings.guiPlayerVolume : guiPlayerVolume;
    applySettingsPayload();
    setFeedback("Overlay scale saved.", "success");
  } catch (error) {
    renderOverlayScaleControl(lastSavedOverlayScalePercent);
    setFeedback(error?.message || "Could not save overlay scale.", "error");
  }
}
async function saveGuiPlayerEnabled(nextValue) {
  if (!settingsPayload || settingsPayload.settings.guiPlayerEnabled === nextValue) {
    return;
  }
  isGuiPlayerSaving = true;
  applyPlaybackState();
  applyGuiPlayerState();
  setOverviewFeedback(nextValue ? "Activating GUI player..." : "Deactivating GUI player...");
  try {
    settingsPayload = await persistSettings({
      guiPlayerEnabled: nextValue
    });
    availableThemes = Array.isArray(settingsPayload.themeOptions) ? settingsPayload.themeOptions : [];
    lastSavedTheme = settingsPayload.settings.theme || lastSavedTheme;
    guiPlayerVolume = Number.isFinite(settingsPayload.settings.guiPlayerVolume) ? settingsPayload.settings.guiPlayerVolume : guiPlayerVolume;
    applySettingsPayload();
    if (nextValue) {
      window.setTimeout(() => {
        syncGuiPlayerFrameVolume();
      }, 250);
    }
    setOverviewFeedback(
      nextValue ? "GUI player activated and will stay on after restart." : "GUI player deactivated and will stay off after restart.",
      "success"
    );
  } catch (error) {
    setOverviewFeedback(error?.message || "Could not update the GUI player.", "error");
  } finally {
    isGuiPlayerSaving = false;
    applyPlaybackState();
    applyGuiPlayerState();
  }
}
async function openYoutubeFallbackLogin() {
  if (!settingsPayload || isSavingSettings) {
    return;
  }
  const loginButton = el("youtube-fallback-login");
  if (loginButton instanceof HTMLButtonElement) {
    loginButton.disabled = true;
  }
  setYoutubeFallbackFeedback("Saving OBS fallback settings...");
  try {
    const fallback = collectSettingsPayload();
    settingsPayload = await persistSettings(Object.fromEntries(Object.entries(fallback).filter(
      ([key]) => ["obsYoutubeFallbackEnabled", "obsWebSocketUrl", "obsWebSocketPassword", "obsYoutubeFallbackSourceName"].includes(key)
    )));
    availableThemes = Array.isArray(settingsPayload.themeOptions) ? settingsPayload.themeOptions : [];
    lastSavedTheme = settingsPayload.settings.theme || lastSavedTheme;
    lastSavedOverlayScalePercent = normalizeOverlayScalePercent(
      settingsPayload.settings.overlayScalePercent
    );
    chatSuppressedCategories = Array.isArray(settingsPayload.settings.chatSuppressedCategories) ? [...settingsPayload.settings.chatSuppressedCategories] : [];
    playbackSuppressedCategories = Array.isArray(settingsPayload.settings.playbackSuppressedCategories) ? [...settingsPayload.settings.playbackSuppressedCategories] : [];
    guiPlayerVolume = Number.isFinite(settingsPayload.settings.guiPlayerVolume) ? settingsPayload.settings.guiPlayerVolume : guiPlayerVolume;
    applySettingsPayload();
    setYoutubeFallbackFeedback("Opening YouTube in the OBS Browser Source...");
    await fetchJson("/api/youtube-fallback/login", {
      method: "POST"
    });
    setYoutubeFallbackFeedback("YouTube opened in OBS. Use Interact on that Browser Source to log in.", "success");
  } catch (error) {
    setYoutubeFallbackFeedback(error?.message || "Could not open YouTube in OBS.", "error");
  } finally {
    applyYoutubeFallbackState();
  }
}
async function startTwitchAuth() {
  setFeedback("Starting Twitch login...");
  try {
    const requestBody = {
      twitchChannel: el("twitchChannel")?.value.trim() || "",
      twitchClientId: el("twitchClientId")?.value.trim() || settingsPayload?.settings?.twitchClientId || ""
    };
    const twitchClientSecret = el("twitchClientSecret")?.value.trim() || "";
    if (twitchClientSecret) {
      requestBody.twitchClientSecret = twitchClientSecret;
    }
    settingsPayload = await fetchJson("/api/twitch-auth/device/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    applySettingsPayload();
    const verificationUrl = settingsPayload.twitchAuthStatus?.verificationUriComplete || settingsPayload.twitchAuthStatus?.verificationUri || "";
    if (verificationUrl) {
      window.open(verificationUrl, "_blank", "noopener");
    }
    setFeedback("Twitch login started. Approve the bot account in your browser.", "success");
  } catch (error) {
    setFeedback(error?.message || "Could not start Twitch login.", "error");
  }
}
async function cancelTwitchAuth() {
  try {
    const payload = await fetchJson("/api/twitch-auth/device/cancel", {
      method: "POST"
    });
    settingsPayload = {
      ...settingsPayload,
      twitchAuthStatus: payload.twitchAuthStatus
    };
    applyRuntimeState();
    setFeedback("Twitch login cancelled.", "warning");
  } catch (error) {
    setFeedback(error?.message || "Could not cancel Twitch login.", "error");
  }
}
async function importYoutubePlaylist(event) {
  event.preventDefault();
  if (youtubePlaylistImportPending) return;
  const input = el("playlist-youtube-input");
  const button = el("playlist-youtube-button");
  const feedback = el("playlist-youtube-feedback");
  const url = input?.value.trim() || "";
  if (!url || !button || !feedback) return;
  youtubePlaylistImportPending = true;
  input.disabled = true;
  button.disabled = true;
  button.textContent = "Importing\u2026";
  feedback.className = "feedback";
  feedback.textContent = "Reading the YouTube playlist and checking its videos. Large playlists may take a moment\u2026";
  try {
    const result = await fetchJson("/api/playlist/import-youtube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    input.value = "";
    clearTimeout(playlistSearchDebounceTimer);
    playlistQuery = "";
    playlistPage = 1;
    const summary = `Added ${result.addedCount} track${result.addedCount === 1 ? "" : "s"} from ${result.title}. Skipped ${result.duplicateCount} duplicate${result.duplicateCount === 1 ? "" : "s"} and ${result.skippedCount} unavailable video${result.skippedCount === 1 ? "" : "s"}.`;
    feedback.textContent = summary;
    feedback.className = `feedback is-${result.addedCount > 0 ? "success" : "warning"}`;
    try {
      await loadPlaylist();
    } catch {
      feedback.textContent = `${summary} Refresh the library to see the updated list.`;
      feedback.className = "feedback is-warning";
    }
  } catch (error) {
    feedback.textContent = error?.message || "Could not import the YouTube playlist.";
    feedback.className = "feedback is-error";
  } finally {
    youtubePlaylistImportPending = false;
    input.disabled = false;
    button.disabled = false;
    button.textContent = "Import YouTube playlist";
  }
}
async function addPlaylistTrack(event) {
  event.preventDefault();
  const input = el("playlist-add-input")?.value.trim() || "";
  if (!input) {
    return;
  }
  if (el("playlist-add-button")) {
    el("playlist-add-button").disabled = true;
  }
  setPlaylistFeedback("Adding track...");
  try {
    const payload = await fetchJson("/api/playlist/tracks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ input })
    });
    setValue("playlist-add-input", "");
    playlistPage = 1;
    await loadPlaylist();
    setPlaylistFeedback(
      payload.alreadyExists ? `Track already exists in the playlist: ${payload.track.title}` : `Added ${payload.track.title} to the playlist.`,
      payload.alreadyExists ? "warning" : "success"
    );
  } catch (error) {
    setPlaylistFeedback(error?.message || "Could not add track.", "error");
  } finally {
    if (el("playlist-add-button")) {
      el("playlist-add-button").disabled = false;
    }
  }
}
function applyOverviewQueueFeedback(payload, action = "Added") {
  const duplicateType = payload.track?.duplicateType;
  if (duplicateType === "playing") {
    setOverviewFeedback(`Track is already playing: ${payload.track.title}`, "warning");
  } else if (duplicateType === "queue") {
    setOverviewFeedback(`Track is already queued: ${payload.track.title}`, "warning");
  } else if (duplicateType === "stopped") {
    setOverviewFeedback(`Track is stopped and ready to restart: ${payload.track.title}`, "warning");
  } else if (duplicateType === "history") {
    setOverviewFeedback(`Track was played recently: ${payload.track.title}`, "warning");
  } else {
    setOverviewFeedback(`${action} ${payload.track.title} to the queue.`, "success");
  }
}
async function queueOverviewTrack(input, {
  clearInput = false,
  action = "Added"
} = {}) {
  const payload = await fetchJson("/api/queue", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input })
  });
  playbackState = payload.state;
  applyPlaybackState();
  if (clearInput) {
    setValue("overview-queue-input", "");
  }
  applyOverviewQueueFeedback(payload, action);
  return payload;
}
async function addOverviewQueueTrack(event) {
  event.preventDefault();
  const input = el("overview-queue-input")?.value.trim() || "";
  if (!input) {
    setOverviewFeedback("Enter a link or search before adding to the queue.", "warning");
    return;
  }
  isQueueSubmitting = true;
  applyPlaybackState();
  setOverviewFeedback("Adding track to the queue...");
  try {
    await queueOverviewTrack(input, {
      clearInput: true,
      action: "Added"
    });
    overviewSearchResults = [];
    applyPlaybackState();
  } catch (error) {
    setOverviewFeedback(error?.message || "Could not add track to the queue.", "error");
  } finally {
    isQueueSubmitting = false;
    applyPlaybackState();
  }
}
async function searchOverviewTracks() {
  const input = el("overview-queue-input")?.value.trim() || "";
  if (!input) {
    setOverviewFeedback("Enter a link or search before searching.", "warning");
    return;
  }
  isOverviewSearchPending = true;
  applyPlaybackState();
  setOverviewFeedback("Searching for tracks...");
  try {
    const payload = await fetchJson("/api/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ input })
    });
    overviewSearchResults = Array.isArray(payload.tracks) ? payload.tracks : [];
    applyPlaybackState();
    setOverviewFeedback(
      `Found ${overviewSearchResults.length} track${overviewSearchResults.length === 1 ? "" : "s"}.`,
      "success"
    );
  } catch (error) {
    overviewSearchResults = [];
    applyPlaybackState();
    setOverviewFeedback(error?.message || "Could not search tracks.", "error");
  } finally {
    isOverviewSearchPending = false;
    applyPlaybackState();
  }
}
async function queueOverviewSearchResult(index) {
  const track = overviewSearchResults[index];
  if (!track?.url) {
    return;
  }
  isQueueSubmitting = true;
  applyPlaybackState();
  setOverviewFeedback("Adding selected search result...");
  try {
    await queueOverviewTrack(track.url, {
      action: "Added"
    });
  } catch (error) {
    setOverviewFeedback(error?.message || "Could not add the selected track to the queue.", "error");
  } finally {
    isQueueSubmitting = false;
    applyPlaybackState();
  }
}
async function sendOverviewPlaybackCommand(url, body2 = null) {
  isPlaybackCommandPending = true;
  applyPlaybackState();
  try {
    const payload = await fetchJson(url, {
      method: "POST",
      ...body2 ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body2) } : {}
    });
    playbackState = payload.state;
    if (payload.state?.autoDjController) {
      autoDjStatus = payload.state.autoDjController;
      renderAutoDjStatus();
    }
    applyPlaybackState();
    return payload;
  } finally {
    isPlaybackCommandPending = false;
    applyPlaybackState();
  }
}
async function toggleOverviewPlayback() {
  const previousStatus = playbackState?.playbackStatus || "idle";
  try {
    const payload = await sendOverviewPlaybackCommand("/api/playback/play-pause");
    const nextStatus = payload.state?.playbackStatus || "idle";
    const nextTrackTitle = payload.state?.currentTrack?.title || payload.result?.track?.title || "the track";
    if (nextStatus === "paused") {
      setOverviewFeedback("Playback paused.", "success");
    } else if (nextStatus === "playing" && previousStatus === "paused") {
      setOverviewFeedback("Playback resumed.", "success");
    } else if (nextStatus === "playing" && previousStatus === "stopped") {
      setOverviewFeedback(`Restarted ${nextTrackTitle}.`, "success");
    } else if (nextStatus === "playing") {
      setOverviewFeedback(`Playing ${nextTrackTitle}.`, "success");
    } else {
      setOverviewFeedback("No track is available to play.", "warning");
    }
  } catch (error) {
    setOverviewFeedback(error?.message || "Could not toggle playback.", "error");
  }
}
async function stopOverviewPlayback() {
  try {
    const payload = await sendOverviewPlaybackCommand("/api/playback/stop");
    if (payload.state?.playbackStatus === "stopped" && payload.result?.title) {
      setOverviewFeedback(`Stopped ${payload.result.title}.`, "success");
    } else {
      setOverviewFeedback("Nothing is currently playing.", "warning");
    }
  } catch (error) {
    setOverviewFeedback(error?.message || "Could not stop playback.", "error");
  }
}
async function playNextOverviewTrack() {
  try {
    const payload = await sendOverviewPlaybackCommand("/api/playback/next");
    const nextTitle = payload.state?.currentTrack?.title;
    if (nextTitle) {
      setOverviewFeedback(`Skipped to ${nextTitle}.`, "success");
    } else {
      setOverviewFeedback("No next track is available right now.", "warning");
    }
  } catch (error) {
    setOverviewFeedback(error?.message || "Could not advance to the next track.", "error");
  }
}
async function saveOverviewCurrentTrack() {
  const track = playbackState?.currentTrack;
  if (!track || track.isSaved || isPlaybackCommandPending) return;
  setOverviewFeedback("Saving the current track...");
  try {
    const payload = await sendOverviewPlaybackCommand("/api/playback/save", { trackId: track.id });
    setOverviewFeedback(payload.result.alreadySaved ? `Already saved: ${payload.result.track.title}.` : `Saved ${payload.result.track.title} to the fallback library.`, "success");
  } catch (error) {
    setOverviewFeedback(error?.message || "Could not save the current track.", "error");
  }
}
async function restartStoppedTrack() {
  try {
    const payload = await sendOverviewPlaybackCommand("/api/playback/play-pause");
    const restartedTitle = payload.state?.currentTrack?.title;
    if (restartedTitle) {
      setOverviewFeedback(`Restarted ${restartedTitle}.`, "success");
    } else {
      setOverviewFeedback("No stopped track is available to restart.", "warning");
    }
  } catch (error) {
    setOverviewFeedback(error?.message || "Could not restart the stopped track.", "error");
  }
}
async function promoteQueueTrack(trackId) {
  if (!trackId) {
    return;
  }
  queueActionTrackId = trackId;
  applyPlaybackState();
  setQueueFeedback("Moving track to the top...");
  try {
    const payload = await fetchJson(`/api/queue/${encodeURIComponent(trackId)}/promote`, {
      method: "POST"
    });
    playbackState = payload.state;
    applyPlaybackState();
    setQueueFeedback(`Moved ${payload.track.title} to the top of the queue.`, "success");
  } catch (error) {
    setQueueFeedback(error?.message || "Could not reorder the queue.", "error");
  } finally {
    queueActionTrackId = "";
    applyPlaybackState();
  }
}
async function removeQueueTrack(trackId) {
  if (!trackId) {
    return;
  }
  queueActionTrackId = trackId;
  applyPlaybackState();
  setQueueFeedback("Removing queued track...");
  try {
    const payload = await fetchJson(`/api/queue/${encodeURIComponent(trackId)}`, {
      method: "DELETE"
    });
    playbackState = payload.state;
    applyPlaybackState();
    setQueueFeedback(`Removed ${payload.track.title} from the queue.`, "success");
  } catch (error) {
    setQueueFeedback(error?.message || "Could not remove the queued track.", "error");
  } finally {
    queueActionTrackId = "";
    applyPlaybackState();
  }
}
async function clearQueue() {
  if (!window.confirm("Clear every queued request?")) {
    return;
  }
  queueActionTrackId = "__clear__";
  applyPlaybackState();
  setQueueFeedback("Clearing queue...");
  try {
    const payload = await fetchJson("/api/queue/clear", {
      method: "POST"
    });
    playbackState = payload.state;
    applyPlaybackState();
    setQueueFeedback(`Cleared ${payload.result.clearedCount} queued track${payload.result.clearedCount === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    setQueueFeedback(error?.message || "Could not clear the queue.", "error");
  } finally {
    queueActionTrackId = "";
    applyPlaybackState();
  }
}
async function deletePlaylistTrack(trackKey) {
  if (!trackKey || !window.confirm("Delete this track from the fallback playlist?")) {
    return;
  }
  try {
    const response = await fetch(`/api/playlist/tracks/${encodeURIComponent(trackKey)}`, {
      method: "DELETE"
    });
    if (!response.ok) {
      let message = `Request failed: ${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.error) {
          message = payload.error;
        }
      } catch {
      }
      throw new Error(message);
    }
    playlistSelectedKeys.delete(trackKey);
    await loadPlaylist();
    setPlaylistFeedback("Track removed from the playlist.", "success");
  } catch (error) {
    setPlaylistFeedback(error?.message || "Could not delete track.", "error");
  }
}
async function exportPlaylist() {
  try {
    const response = await fetch("/api/playlist/export", {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = "playlist-export.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    setPlaylistFeedback("Playlist exported.", "success");
  } catch (error) {
    setPlaylistFeedback(error?.message || "Could not export playlist.", "error");
  }
}
async function exportSelectedPlaylistTracks() {
  if (playlistSelectedKeys.size === 0) {
    return;
  }
  try {
    const response = await fetch("/api/playlist/export-selected", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        trackKeys: Array.from(playlistSelectedKeys)
      })
    });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = "playlist-selected-export.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    setPlaylistFeedback("Selected playlist tracks exported.", "success");
  } catch (error) {
    setPlaylistFeedback(error?.message || "Could not export the selected playlist tracks.", "error");
  }
}
async function editPlaylistTrackTitle(trackKey, currentTitle) {
  if (!trackKey) {
    return;
  }
  const nextTitle = window.prompt("Edit playlist title", currentTitle || "");
  if (nextTitle === null) {
    return;
  }
  try {
    const payload = await fetchJson(`/api/playlist/tracks/${encodeURIComponent(trackKey)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: nextTitle
      })
    });
    await loadPlaylist();
    setPlaylistFeedback(`Updated title: ${payload.track.title}`, "success");
  } catch (error) {
    setPlaylistFeedback(error?.message || "Could not update the playlist title.", "error");
  }
}
async function refreshPlaylistTrackMetadata(trackKey) {
  if (!trackKey) {
    return;
  }
  try {
    const payload = await fetchJson(`/api/playlist/tracks/${encodeURIComponent(trackKey)}/refresh-metadata`, {
      method: "POST"
    });
    await loadPlaylist();
    setPlaylistFeedback(`Refreshed metadata: ${payload.track.title}`, "success");
  } catch (error) {
    setPlaylistFeedback(error?.message || "Could not refresh playlist metadata.", "error");
  }
}
async function exportDiagnostics() {
  try {
    const response = await fetch("/api/diagnostics/export", {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = "diagnostics-export.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    setFeedback("Diagnostics exported.", "success");
  } catch (error) {
    setFeedback(error?.message || "Could not export diagnostics.", "error");
  }
}
async function importPlaylist(csvText) {
  try {
    const payload = await fetchJson("/api/playlist/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        csvText,
        mode: playlistImportMode
      })
    });
    playlistPage = 1;
    playlistSelectedKeys = /* @__PURE__ */ new Set();
    await loadPlaylist();
    setPlaylistFeedback(`Import finished: ${payload.importedCount} added, ${payload.duplicateCount} duplicates skipped, ${payload.finalCount} total.`, "success");
  } catch (error) {
    setPlaylistFeedback(error?.message || "Could not import playlist.", "error");
  }
}
async function copyFieldValue(targetId) {
  const target = el(targetId);
  if (!target) {
    return;
  }
  try {
    await navigator.clipboard.writeText(target.value);
    setFeedback("Copied to clipboard.", "success");
  } catch {
    target.select();
    document.execCommand("copy");
    setFeedback("Copied to clipboard.", "success");
  }
}
function openFieldValue(targetId) {
  const target = el(targetId);
  const url = target?.value?.trim();
  if (url) {
    window.open(url, "_blank", "noopener");
  }
}
function escapeReleaseNoteHtmlText(value) {
  return String(value ?? "").replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);)/gi, "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function stripUnsafeReleaseNoteBlocks(value) {
  return String(value ?? "").replace(
    /<\s*(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ""
  );
}
function sanitizeReleaseNotesHtml(value) {
  const allowedTags = /* @__PURE__ */ new Set([
    "a",
    "blockquote",
    "br",
    "code",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "i",
    "li",
    "ol",
    "p",
    "pre",
    "strong",
    "ul"
  ]);
  const source = stripUnsafeReleaseNoteBlocks(value);
  const tagPattern = /<\/?\s*([a-z][a-z0-9]*)\b[^>]*>/gi;
  let result = "";
  let cursor = 0;
  for (const match of source.matchAll(tagPattern)) {
    const matchIndex = match.index ?? 0;
    const rawTag = match[0];
    const tagName = match[1].toLowerCase();
    result += escapeReleaseNoteHtmlText(source.slice(cursor, matchIndex));
    if (allowedTags.has(tagName)) {
      if (tagName === "br") {
        result += "<br>";
      } else if (/^<\s*\//.test(rawTag)) {
        result += `</${tagName}>`;
      } else {
        result += `<${tagName}>`;
      }
    }
    cursor = matchIndex + rawTag.length;
  }
  result += escapeReleaseNoteHtmlText(source.slice(cursor));
  return result;
}
function hasReleaseNoteHtml(value) {
  return /<\/?(?:a|blockquote|br|code|div|em|h[1-6]|i|li|ol|p|pre|strong|ul)\b/i.test(
    String(value ?? "")
  );
}
function formatMarkdown(text) {
  if (!text) {
    return "";
  }
  if (hasReleaseNoteHtml(text)) {
    return sanitizeReleaseNotesHtml(text);
  }
  return htmlEscape(text).replace(/^# (.*$)/gm, "<h1>$1</h1>").replace(/^## (.*$)/gm, "<h2>$1</h2>").replace(/^### (.*$)/gm, "<h3>$1</h3>").replace(/^\* (.*$)/gm, "<li>$1</li>").replace(/^- (.*$)/gm, "<li>$1</li>").replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>").replace(/<\/ul>\s*<ul>/g, "");
}
function syncUpdateCheckButton(isChecking) {
  const button = el("check-for-updates-button");
  if (!button) {
    return;
  }
  button.disabled = isChecking;
  button.textContent = isChecking ? "Checking..." : "Check for updates";
}
function handleUpdaterStatus(status) {
  if (status.appVersion) {
    setText("app-version-badge", `v${status.appVersion}`);
    if (el("app-version-badge")) {
      el("app-version-badge").className = "status-pill status-pill--ok";
    }
  }
  updateErrorText.hidden = true;
  updateProgressContainer.hidden = true;
  syncUpdateCheckButton(status.state === "checking");
  if (status.state === "available") {
    updateVersionText.textContent = `Version ${status.version} is now available.`;
    updateReleaseNotes.innerHTML = formatMarkdown(status.releaseNotes);
    updateActionBtn.textContent = "Download Update";
    updateActionBtn.disabled = false;
    updateModal.classList.add("is-visible");
    if (isManualUpdateCheckPending) {
      setFeedback("Update found. Review the release notes below.", "success");
      isManualUpdateCheckPending = false;
    }
  } else if (status.state === "checking") {
    if (isManualUpdateCheckPending) {
      setFeedback("Checking for updates...");
    }
  } else if (status.state === "downloading") {
    updateModal.classList.add("is-visible");
    updateProgressContainer.hidden = false;
    updateProgressFill.style.width = `${status.progress}%`;
    updateProgressText.textContent = `Downloading... ${Math.round(status.progress)}%`;
    updateActionBtn.disabled = true;
    updateActionBtn.textContent = "Downloading...";
  } else if (status.state === "downloaded") {
    updateModal.classList.add("is-visible");
    updateActionBtn.disabled = false;
    updateActionBtn.textContent = "Restart and Install";
  } else if (status.state === "error") {
    updateModal.classList.add("is-visible");
    updateErrorText.textContent = `Update Error: ${status.error}`;
    updateErrorText.hidden = false;
    updateActionBtn.disabled = false;
    updateActionBtn.textContent = "Try Again";
    if (isManualUpdateCheckPending) {
      setFeedback(status.error || "Could not check for updates.", "error");
      isManualUpdateCheckPending = false;
    }
  } else {
    updateModal.classList.remove("is-visible");
    if (isManualUpdateCheckPending) {
      setFeedback("You're already on the latest version.", "success");
      isManualUpdateCheckPending = false;
    }
  }
}
async function checkForUpdates() {
  if (isManualUpdateCheckPending) {
    return;
  }
  isManualUpdateCheckPending = true;
  setFeedback("Checking for updates...");
  syncUpdateCheckButton(true);
  try {
    const status = await fetchJson("/api/updater/check", {
      method: "POST"
    });
    handleUpdaterStatus(status);
  } catch (error) {
    isManualUpdateCheckPending = false;
    syncUpdateCheckButton(false);
    setFeedback(error?.message || "Could not check for updates.", "error");
  }
}
renderDashboard();
overviewProgressTimer = window.setInterval(() => {
  renderOverviewProgress();
}, 500);
root.addEventListener("click", (event) => {
  if (event.target.id === "youtube-api-check") {
    void checkEnteredYouTubeApiKey();
    return;
  }
  if (!(event.target instanceof Element)) {
    return;
  }
  const tabButton = event.target.closest("[data-tab], [data-tab-link]");
  if (tabButton) {
    selectTab(tabButton.getAttribute("data-tab") || tabButton.getAttribute("data-tab-link") || "overview", {
      focus: tabButton.hasAttribute("data-tab-link")
    });
    return;
  }
  const settingsLink = event.target.closest(".settings-nav a[href^='#']");
  if (settingsLink) {
    event.preventDefault();
    const section = el(settingsLink.getAttribute("href").slice(1));
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    section?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    const heading = section?.querySelector("h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    return;
  }
  const pairingButton = event.target.closest("[data-autodj-pairing-decision]");
  if (pairingButton) {
    void answerAutoDjPairing(
      pairingButton.getAttribute("data-autodj-pairing-request-id") || "",
      pairingButton.getAttribute("data-autodj-pairing-decision") || "declined"
    );
    return;
  }
  const reviewActionButton = event.target.closest("[data-playlist-review-action]");
  if (reviewActionButton) {
    const trackKey = reviewActionButton.getAttribute("data-playlist-review-key");
    const action = reviewActionButton.getAttribute("data-playlist-review-action");
    if (action === "queue") {
      void queueSinglePlaylistTrack(trackKey);
      return;
    }
    if (action === "refresh") {
      void refreshPlaylistTrackMetadata(trackKey);
      return;
    }
    if (action === "delete") {
      void deletePlaylistTrack(trackKey);
      return;
    }
  }
  const deleteButton = event.target.closest("[data-playlist-delete-key]");
  if (deleteButton) {
    void deletePlaylistTrack(deleteButton.getAttribute("data-playlist-delete-key"));
    return;
  }
  const editButton = event.target.closest("[data-playlist-edit-key]");
  if (editButton) {
    void editPlaylistTrackTitle(
      editButton.getAttribute("data-playlist-edit-key"),
      editButton.getAttribute("data-playlist-title")
    );
    return;
  }
  const refreshButton = event.target.closest("[data-playlist-refresh-key]");
  if (refreshButton) {
    void refreshPlaylistTrackMetadata(refreshButton.getAttribute("data-playlist-refresh-key"));
    return;
  }
  const copyButton = event.target.closest("[data-copy-target]");
  if (copyButton) {
    void copyFieldValue(copyButton.getAttribute("data-copy-target"));
    return;
  }
  const openButton = event.target.closest("[data-open-url-target]");
  if (openButton) {
    openFieldValue(openButton.getAttribute("data-open-url-target"));
    return;
  }
  const queueActionButton = event.target.closest("[data-queue-action]");
  if (queueActionButton) {
    const trackId = queueActionButton.getAttribute("data-queue-track-id");
    const action = queueActionButton.getAttribute("data-queue-action");
    if (action === "move-up") {
      void moveQueueTrack(trackId, "up");
      return;
    }
    if (action === "move-down") {
      void moveQueueTrack(trackId, "down");
      return;
    }
    if (action === "promote") {
      void promoteQueueTrack(trackId);
      return;
    }
    if (action === "remove") {
      void removeQueueTrack(trackId);
      return;
    }
  }
  const overviewSearchAddButton = event.target.closest("[data-overview-search-add-index]");
  if (overviewSearchAddButton) {
    const index = Number.parseInt(overviewSearchAddButton.getAttribute("data-overview-search-add-index") || "-1", 10);
    if (index >= 0) {
      void queueOverviewSearchResult(index);
    }
    return;
  }
  if (event.target.id === "save-button") {
    void saveSettings();
  } else if (event.target.id === "autodj-refresh") {
    void loadAutoDjStatus().catch((error) => setText("autodj-feedback", error?.message || "Could not load AutoDJ status."));
  } else if (event.target.id === "autodj-discover") {
    void discoverAutoDj();
  } else if (event.target.id === "autodj-activation") {
    void setAutoDjActivation();
  } else if (event.target.id === "autodj-mix-next") {
    void mixNextAutoDj();
  } else if (event.target.id === "check-for-updates-button") {
    void checkForUpdates();
  } else if (event.target.id === "open-appdata-button") {
    fetch("/api/open-runtime-dir", { method: "POST" }).catch(() => {
    });
  } else if (event.target.id === "export-diagnostics-button") {
    void exportDiagnostics();
  } else if (event.target.id === "twitch-auth-start") {
    void startTwitchAuth();
  } else if (event.target.id === "twitch-auth-cancel") {
    void cancelTwitchAuth();
  } else if (event.target.id === "chat-category-add") {
    const value = String(el("chat-category-input")?.value || "").trim();
    if (value && !chatSuppressedCategories.some((item) => item.toLowerCase() === value.toLowerCase())) {
      chatSuppressedCategories = [...chatSuppressedCategories, value];
      setValue("chat-category-input", "");
      renderCategorySelect("chat-category-select", chatSuppressedCategories);
    }
  } else if (event.target.id === "chat-category-delete") {
    chatSuppressedCategories = chatSuppressedCategories.filter((item) => item !== (el("chat-category-select")?.value || ""));
    renderCategorySelect("chat-category-select", chatSuppressedCategories);
  } else if (event.target.id === "playback-category-add") {
    const value = String(el("playback-category-input")?.value || "").trim();
    if (value && !playbackSuppressedCategories.some((item) => item.toLowerCase() === value.toLowerCase())) {
      playbackSuppressedCategories = [...playbackSuppressedCategories, value];
      setValue("playback-category-input", "");
      renderCategorySelect("playback-category-select", playbackSuppressedCategories);
    }
  } else if (event.target.id === "playback-category-delete") {
    playbackSuppressedCategories = playbackSuppressedCategories.filter((item) => item !== (el("playback-category-select")?.value || ""));
    renderCategorySelect("playback-category-select", playbackSuppressedCategories);
  } else if (event.target.id === "playlist-prev-page") {
    playlistPage = Math.max(1, playlistPage - 1);
    void loadPlaylist().catch((error) => setPlaylistFeedback(error?.message || "Could not load playlist.", "error"));
  } else if (event.target.id === "playlist-next-page") {
    playlistPage = Math.min(playlistTotalPages, playlistPage + 1);
    void loadPlaylist().catch((error) => setPlaylistFeedback(error?.message || "Could not load playlist.", "error"));
  } else if (event.target.id === "playlist-import-append") {
    playlistImportMode = "append";
    if (el("playlist-import-file")) {
      el("playlist-import-file").value = "";
      el("playlist-import-file").click();
    }
  } else if (event.target.id === "playlist-import-replace") {
    if (window.confirm("Replace the entire fallback playlist with the CSV you select?") && el("playlist-import-file")) {
      playlistImportMode = "replace";
      el("playlist-import-file").value = "";
      el("playlist-import-file").click();
    }
  } else if (event.target.id === "playlist-export-button") {
    void exportPlaylist();
  } else if (event.target.id === "playlist-fresh-button") {
    void startFreshLibrary();
  } else if (event.target.id === "playlist-export-selected-button") {
    void exportSelectedPlaylistTracks();
  } else if (event.target.id === "playlist-bulk-queue-button") {
    void bulkQueuePlaylistTracks();
  } else if (event.target.id === "playlist-bulk-delete-button") {
    void bulkDeletePlaylistTracks();
  } else if (event.target.id === "queue-clear-button") {
    void clearQueue();
  } else if (event.target.id === "overview-play-pause") {
    void toggleOverviewPlayback();
  } else if (event.target.id === "overview-stop") {
    void stopOverviewPlayback();
  } else if (event.target.id === "overview-next") {
    void playNextOverviewTrack();
  } else if (event.target.id === "overview-save") {
    void saveOverviewCurrentTrack();
  } else if (event.target.id === "overview-search-button") {
    void searchOverviewTracks();
  } else if (event.target.id === "playback-restart-stopped") {
    void restartStoppedTrack();
  } else if (event.target.id === "youtube-fallback-login") {
    void openYoutubeFallbackLogin();
  } else if (event.target.id === "overview-gui-player-toggle") {
    void saveGuiPlayerEnabled(!(settingsPayload?.settings?.guiPlayerEnabled === true));
  } else if (event.target.id === "requests-autosave-button") {
    toggleRequestPolicyAutosave();
  }
});
root.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }
  if (form.id === "settings-form") {
    void saveSettings(event);
  } else if (form.id === "overview-queue-form") {
    void addOverviewQueueTrack(event);
  } else if (form.id === "playlist-add-form") {
    void addPlaylistTrack(event);
  } else if (form.id === "playlist-youtube-form") {
    void importYoutubePlaylist(event);
  }
});
root.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (target.id === "theme-select" && target instanceof HTMLSelectElement && !isHydratingForm) {
    await saveThemeSelection(target.value);
  }
  if (target.id === "overlay-scale-slider" && target instanceof HTMLInputElement && !isHydratingForm) {
    await saveOverlayScaleSelection(target.value);
  }
  if (target.id === "radio-mode-enabled-toggle" && target instanceof HTMLInputElement) {
    const radioTrackCountInput = el("radio-track-count");
    if (radioTrackCountInput instanceof HTMLInputElement) {
      radioTrackCountInput.disabled = !target.checked;
    }
  }
  if (target.id === "youtube-fallback-enabled-toggle" && target instanceof HTMLInputElement) {
    const status = el("youtube-fallback-status");
    const loginButton = el("youtube-fallback-login");
    if (loginButton instanceof HTMLButtonElement) {
      loginButton.disabled = !target.checked || isSavingSettings;
    }
    if (status) {
      status.textContent = target.checked ? "Fallback settings changed. Save or open YouTube to apply them." : "OBS fallback is off.";
    }
  }
  if (target.id === "playlist-sort-select" && target instanceof HTMLSelectElement) {
    playlistSortBy = target.value || "recent";
    playlistPage = 1;
    await loadPlaylist();
  }
  if ((target.id === "requests-enabled-toggle" || target.id === "requests-auto-save-completed-toggle") && target instanceof HTMLInputElement) {
    syncRequestPolicyDraftFromInputs();
    applyRequestPolicyState();
    scheduleRequestPolicyAutosave();
  }
  if (target.id === "requests-access-level" && target instanceof HTMLSelectElement) {
    syncRequestPolicyDraftFromInputs();
    applyRequestPolicyState();
    scheduleRequestPolicyAutosave();
  }
  if (target.id === "requests-allow-search-toggle" && target instanceof HTMLInputElement) {
    syncRequestPolicyDraftFromInputs();
    applyRequestPolicyState();
    scheduleRequestPolicyAutosave();
  }
  if (target.id === "requests-reject-live-toggle" && target instanceof HTMLInputElement) {
    syncRequestPolicyDraftFromInputs();
    applyRequestPolicyState();
    scheduleRequestPolicyAutosave();
  }
  if (target.id === "requests-safe-search" && target instanceof HTMLSelectElement) {
    syncRequestPolicyDraftFromInputs();
    applyRequestPolicyState();
    scheduleRequestPolicyAutosave();
  }
  if ((target.id === "requests-provider-youtube" || target.id === "requests-provider-soundcloud" || target.id === "requests-provider-spotify" || target.id === "requests-provider-suno") && target instanceof HTMLInputElement) {
    syncRequestPolicyDraftFromInputs();
    applyRequestPolicyState();
    scheduleRequestPolicyAutosave();
  }
  if (target.id === "playlist-select-page" && target instanceof HTMLInputElement) {
    const currentItems = playlistPayload?.items || [];
    if (target.checked) {
      currentItems.forEach((track) => {
        playlistSelectedKeys.add(track.key);
      });
    } else {
      currentItems.forEach((track) => {
        playlistSelectedKeys.delete(track.key);
      });
    }
    applyPlaylistState();
  }
  if (target.id === "playlist-import-file" && target instanceof HTMLInputElement) {
    const file = target.files?.[0];
    if (file) {
      setPlaylistFeedback("Importing playlist...");
      try {
        await importPlaylist(await file.text());
      } catch (error) {
        setPlaylistFeedback(error?.message || "Could not read import file.", "error");
      } finally {
        target.value = "";
      }
    }
  } else if (target.id === "overview-gui-player-volume" && target instanceof HTMLInputElement) {
    if (guiPlayerVolumeSaveTimer) {
      window.clearTimeout(guiPlayerVolumeSaveTimer);
      guiPlayerVolumeSaveTimer = null;
    }
    await persistGuiPlayerVolume();
  } else if (target.matches('[data-chat-command-field="enabled"]') && target instanceof HTMLInputElement) {
    const label = target.closest(".command-toggle")?.querySelector("span");
    if (label) {
      label.textContent = target.checked ? "Enabled" : "Disabled";
    }
  } else if (target.matches("[data-playlist-select-key]") && target instanceof HTMLInputElement) {
    const trackKey = target.getAttribute("data-playlist-select-key") || "";
    if (!trackKey) {
      return;
    }
    if (target.checked) {
      playlistSelectedKeys.add(trackKey);
    } else {
      playlistSelectedKeys.delete(trackKey);
    }
    applyPlaylistState();
  }
});
root.addEventListener("input", (event) => {
  if (event.target.id === "youtubeApiKey") {
    resetYouTubeApiCheck();
  }
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (target.id === "playlist-search-input" && target instanceof HTMLInputElement) {
    window.clearTimeout(playlistSearchDebounceTimer);
    playlistSearchDebounceTimer = window.setTimeout(() => {
      playlistQuery = target.value.trim();
      playlistPage = 1;
      void loadPlaylist().catch((error) => setPlaylistFeedback(error?.message || "Could not load playlist.", "error"));
    }, 180);
  } else if (target.id === "overlay-scale-slider" && target instanceof HTMLInputElement) {
    renderOverlayScaleControl(target.value);
  } else if ((target.id === "requests-max-queue-length" || target.id === "requests-max-per-user" || target.id === "requests-duplicate-history-count" || target.id === "requests-cooldown-seconds" || target.id === "requests-max-duration-seconds") && target instanceof HTMLInputElement) {
    syncRequestPolicyDraftFromInputs();
    applyRequestPolicyState();
    scheduleRequestPolicyAutosave();
  } else if ((target.id === "requests-blocked-users" || target.id === "requests-blocked-domains" || target.id === "requests-blocked-phrases" || target.id === "requests-blocked-youtube-channels" || target.id === "requests-blocked-soundcloud-users") && target instanceof HTMLTextAreaElement) {
    syncRequestPolicyDraftFromInputs();
    scheduleRequestPolicyAutosave();
  } else if (target.id === "overview-gui-player-volume" && target instanceof HTMLInputElement) {
    guiPlayerVolume = Number.parseInt(target.value || "100", 10);
    if (!Number.isFinite(guiPlayerVolume)) {
      guiPlayerVolume = 100;
    }
    guiPlayerVolume = Math.min(100, Math.max(0, guiPlayerVolume));
    applyGuiPlayerState();
    syncGuiPlayerFrameVolume();
    scheduleGuiPlayerVolumeSave();
  }
});
root.addEventListener("keydown", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (target.matches('[role="tab"]') && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const index = DASHBOARD_TABS.findIndex(({ id }) => id === target.dataset.tab);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? DASHBOARD_TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + DASHBOARD_TABS.length) % DASHBOARD_TABS.length;
    selectTab(DASHBOARD_TABS[nextIndex].id, { focus: true });
    return;
  }
  if (event.key === "Enter" && target.id === "chat-category-input") {
    event.preventDefault();
    el("chat-category-add")?.click();
  }
  if (event.key === "Enter" && target.id === "playback-category-input") {
    event.preventDefault();
    el("playback-category-add")?.click();
  }
  if (event.key === "Enter" && (target.id === "requests-max-queue-length" || target.id === "requests-max-per-user" || target.id === "requests-duplicate-history-count" || target.id === "requests-cooldown-seconds" || target.id === "requests-max-duration-seconds" || target.id === "playback-startup-timeout-seconds")) {
    event.preventDefault();
    if (getRequestPolicyAutosaveEnabled() && (target.id === "requests-max-queue-length" || target.id === "requests-max-per-user" || target.id === "requests-duplicate-history-count" || target.id === "requests-cooldown-seconds" || target.id === "requests-max-duration-seconds")) {
      void saveRequestPolicySection({
        requestPolicy: collectRequestPolicyPayload(),
        reason: "manual"
      });
    } else {
      void saveSettings();
    }
  }
});
for (const eventName of ["input", "change", "click"]) {
  root.addEventListener(eventName, () => updateSettingsSaveState());
}
window.addEventListener("beforeunload", (event) => {
  if (Object.keys(pendingSettingsDraft()).length || isSavingSettings || isRequestPolicyAutosaveSaving) {
    event.preventDefault();
    event.returnValue = "";
  }
});
updateSkipBtn.addEventListener("click", () => {
  updateModal.classList.remove("is-visible");
});
updateActionBtn.addEventListener("click", () => {
  const buttonText = updateActionBtn.textContent;
  if (buttonText === "Download Update" || buttonText === "Try Again") {
    fetch("/api/updater/download", { method: "POST" }).catch(() => {
    });
  } else if (buttonText === "Restart and Install") {
    fetch("/api/updater/install", { method: "POST" }).catch(() => {
    });
  }
});
fetch("/api/updater").then((response) => response.json()).then(handleUpdaterStatus).catch(() => {
});
if (socket) {
  socket.on("app:updater-status", handleUpdaterStatus);
}
window.setInterval(() => {
  void loadPlaybackState().catch(() => {
  });
}, 3e3);
autoDjStatusTimer = window.setInterval(() => {
  if (activeTab === "autodj") {
    void loadAutoDjStatus().catch(() => {
    });
  }
}, 3e3);
window.setInterval(() => {
  if (!isSavingSettings && !isHydratingForm && settingsPayload) {
    void fetchJson("/api/runtime-status").then((payload) => {
      settingsPayload = {
        ...settingsPayload,
        runtime: payload.runtime,
        twitchStatus: payload.twitchStatus,
        twitchAuthStatus: payload.twitchAuthStatus,
        desktopIntegration: payload.desktopIntegration
      };
      applyRuntimeState();
    }).catch(() => {
    });
  }
}, 3e3);
window.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "tsrp:overlay-size") {
    const frameWrap = document.getElementById("overview-player-frame-wrap");
    const frame = document.getElementById("overview-player-frame");
    if (frameWrap && data.height > 0) {
      frameWrap.style.minHeight = `${data.height + 8}px`;
    }
    if (frame && data.height > 0) {
      frame.style.minHeight = `${data.height + 8}px`;
    }
  }
});
void Promise.all([loadSettings(), loadPlaybackState(), loadPlaylist(), loadAutoDjStatus()]).catch((error) => {
  setFeedback(error?.message || "Could not load dashboard data.", "error");
});
