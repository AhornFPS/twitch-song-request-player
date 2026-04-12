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
function renderDashboard() {
  body.dataset.dashboardLayout = "atlas";
  root.innerHTML = `
    <div class="app-shell atlas-shell">
      <header class="panel shell-header shell-header--compact">
        <div class="hero-copy hero-copy--minimal">
          <h1>Twitch Song Request Player</h1>
        </div>
        <div class="hero-side">
          <div class="status-strip">
            <span id="app-version-badge" class="status-pill status-pill--idle">Version Loading</span>
            <span id="twitch-status-pill" class="status-pill status-pill--idle">Waiting</span>
            <span id="twitch-category-pill" class="status-pill status-pill--idle">Category unknown</span>
            <span id="requests-status-pill" class="status-pill status-pill--idle">Requests loading</span>
            <span id="server-port-pill" class="status-pill status-pill--accent">Port 3000</span>
          </div>
          <div class="appearance-controls appearance-controls--single">
            <label class="control-field">
              <span class="control-field__label">Overlay theme</span>
              <select id="theme-select"></select>
            </label>
            <label class="control-field control-field--slider">
              <span class="control-field__label">Overlay scale</span>
              <div class="control-range">
                <input
                  id="overlay-scale-slider"
                  class="control-range__input"
                  type="range"
                  min="50"
                  max="200"
                  step="5"
                  value="100"
                />
                <span id="overlay-scale-value" class="control-range__value">100%</span>
              </div>
            </label>
            <button id="check-for-updates-button" class="secondary-button" type="button">Check for updates</button>
            <button id="open-appdata-button" class="secondary-button" type="button">Open Settings Folder</button>
            <button id="save-button" class="primary-button" type="button">Save settings</button>
          </div>
        </div>
      </header>

      <p id="save-feedback" class="feedback" role="status" aria-live="polite"></p>

      <nav class="atlas-tabs" aria-label="Dashboard sections">
        <button class="tab-button" type="button" data-tab="overview">Overview</button>
        <button class="tab-button" type="button" data-tab="playback">Playback</button>
        <button class="tab-button" type="button" data-tab="queue">Queue</button>
        <button class="tab-button" type="button" data-tab="requests">Requests</button>
        <button class="tab-button" type="button" data-tab="settings">Settings</button>
        <button class="tab-button" type="button" data-tab="library">Library</button>
      </nav>

      <section id="tab-overview" class="atlas-view">
        <div class="atlas-grid atlas-grid--overview">
          <section class="panel card-panel">
            <div class="panel__header">
              <div>
                <p class="panel__eyebrow">Runtime</p>
                <h2>Server and OBS</h2>
              </div>
            </div>
            <div class="info-grid">
              <article class="info-card">
                <p class="info-card__label">Twitch status</p>
                <p id="twitch-status-text" class="info-card__value">Waiting for configuration.</p>
              </article>
              <article class="info-card">
                <p class="info-card__label">Overlay URL</p>
                <div class="copy-row">
                  <input id="overlay-url" class="control-input" type="text" readonly />
                  <button class="copy-row__button" type="button" data-copy-target="overlay-url">Copy</button>
                </div>
              </article>
              <article class="info-card">
                <p class="info-card__label">OBS local loader file</p>
                <div class="copy-row">
                  <input id="overlay-loader-file-path" class="control-input" type="text" readonly />
                  <button class="copy-row__button" type="button" data-copy-target="overlay-loader-file-path">Copy</button>
                </div>
                <p class="field__hint">In OBS, enable <strong>Local file</strong> and select this file if you want the overlay to reconnect automatically when OBS opens before the app.</p>
              </article>
              <article class="info-card info-card--wide">
                <p class="info-card__label">Restart notice</p>
                <p id="restart-note" class="info-card__body">Port changes are applied immediately when you restart the app.</p>
              </article>
            </div>
          </section>

          <section class="panel card-panel">
            <div class="panel__header">
              <div>
                <p class="panel__eyebrow">Playback</p>
                <h2>Now playing</h2>
              </div>
              <div class="playback-panel__header-actions">
                <span id="playback-state-pill" class="status-pill status-pill--idle">Idle</span>
                <button id="overview-gui-player-toggle" class="secondary-button" type="button">Activate GUI player</button>
              </div>
            </div>
            <div class="playback-card">
              <p id="current-track-title" class="playback-card__title">Waiting for a track</p>
              <p id="current-track-meta" class="playback-card__meta">Queue is empty. Fallback playlist will play automatically.</p>
              <div id="overview-progress" class="playback-progress" hidden>
                <div class="playback-progress__labels">
                  <span id="overview-progress-elapsed">0:00</span>
                  <span id="overview-progress-duration">0:00</span>
                </div>
                <div class="playback-progress__track" aria-hidden="true">
                  <div id="overview-progress-fill" class="playback-progress__fill"></div>
                </div>
              </div>
              <div class="playback-controls">
                <button id="overview-play-pause" class="primary-button" type="button">Play</button>
                <button id="overview-stop" class="secondary-button" type="button">Stop</button>
                <button id="overview-next" class="ghost-button" type="button">Next track</button>
              </div>
              <form id="overview-queue-form" class="queue-add-form">
                <input id="overview-queue-input" class="control-input" type="text" placeholder="YouTube / SoundCloud / Spotify / Suno URL or search text" autocomplete="off" />
                <div class="overview-queue-actions">
                  <button id="overview-queue-button" class="secondary-button" type="submit">Add to queue</button>
                  <button id="overview-search-button" class="ghost-button" type="button">Search</button>
                </div>
              </form>
              <p class="field__hint">Paste a direct link to queue it immediately, or search first and choose a result.</p>
              <p id="overview-feedback" class="feedback" role="status" aria-live="polite"></p>
              <div id="overview-search-results" class="history-list" hidden></div>
              <ul id="queue-preview" class="queue-preview"></ul>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-playback" class="atlas-view" hidden>
        <div class="stack-layout">
          <section class="panel card-panel">
            <div class="panel__header">
              <div>
                <p class="panel__eyebrow">Playback</p>
                <h2>Desktop player and transport</h2>
              </div>
              <div class="playback-panel__header-actions">
                <span id="playback-tab-pill" class="status-pill status-pill--idle">Idle</span>
                <button id="playback-restart-stopped" class="secondary-button" type="button">Restart stopped track</button>
              </div>
            </div>
            <div class="playback-card">
              <p id="playback-tab-title" class="playback-card__title">Waiting for a track</p>
              <p id="playback-tab-meta" class="playback-card__meta">Queue is empty. Fallback playlist will play automatically.</p>
              <section class="overview-player-panel">
                <div class="overview-player-panel__header">
                  <div>
                    <p class="panel__eyebrow">GUI player</p>
                    <p id="overview-gui-player-status" class="overview-player-panel__copy">Inactive. Activate it to play inside the desktop app without OBS.</p>
                  </div>
                </div>
                <label class="overview-player-volume">
                  <span class="overview-player-volume__label">Volume</span>
                  <div class="overview-player-volume__controls">
                    <input id="overview-gui-player-volume" class="overview-player-volume__slider" type="range" min="0" max="100" step="1" value="100" />
                    <span id="overview-gui-player-volume-value" class="overview-player-volume__value">100%</span>
                  </div>
                </label>
                <div id="overview-player-frame-wrap" class="overview-player-frame-wrap" hidden>
                  <iframe
                    id="overview-player-frame"
                    class="overview-player-frame"
                    title="Embedded desktop player"
                    allow="autoplay"
                  ></iframe>
                </div>
              </section>
              <div class="request-limit-grid">
                <label class="field">
                  <span class="field__label">Player startup timeout (seconds)</span>
                  <input id="playback-startup-timeout-seconds" class="control-input" type="number" min="0" step="1" />
                  <span class="field__hint">If YouTube or SoundCloud never actually starts, the embedded player reports an error after this many seconds. Set to 0 to disable the timeout.</span>
                </label>
              </div>
            </div>
          </section>

          <section class="panel card-panel queue-panel">
            <div class="panel__header">
              <div>
                <p class="panel__eyebrow">History</p>
                <h2>Recent playback</h2>
              </div>
            </div>
            <div id="history-list" class="history-list"></div>
          </section>

          <section class="panel card-panel queue-panel">
            <div class="panel__header">
              <div>
                <p class="panel__eyebrow">Admin</p>
                <h2>Recent control activity</h2>
              </div>
            </div>
            <div id="admin-event-list" class="history-list"></div>
          </section>
        </div>
      </section>

      <section id="tab-queue" class="atlas-view" hidden>
        <div class="stack-layout">
          <section class="panel card-panel queue-panel">
            <div class="panel__header">
              <div>
                <p class="panel__eyebrow">Queue</p>
                <h2>Live request queue</h2>
              </div>
              <div class="button-row">
                <button id="queue-clear-button" class="ghost-button" type="button">Clear queue</button>
              </div>
            </div>
            <p id="queue-feedback" class="feedback" role="status" aria-live="polite"></p>
            <div class="queue-table-wrap">
              <table class="playlist-table">
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Requester</th>
                    <th scope="col">Provider</th>
                    <th scope="col" class="playlist-table__actions queue-table__actions">Actions</th>
                  </tr>
                </thead>
                <tbody id="queue-table-body"></tbody>
              </table>
              <div id="queue-empty-state" class="empty-state" hidden>No queued requests yet.</div>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-requests" class="atlas-view" hidden>
        <div class="stack-layout">
          <section class="panel card-panel">
            <div class="panel__header">
              <div>
                <p class="panel__eyebrow">Requests</p>
                <h2>Viewer request controls</h2>
              </div>
              <div class="button-row button-row--compact request-header-actions">
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
            <div class="request-policy-row">
              <label class="toggle-card" for="requests-enabled-toggle">
                <span class="toggle-card__copy">
                  <span class="toggle-card__title">Accept song requests</span>
                  <span id="requests-status-copy" class="toggle-card__body">Viewer requests can be queued from chat.</span>
                </span>
                <input id="requests-enabled-toggle" type="checkbox" />
              </label>
            </div>
            <div class="request-limit-grid">
              <label class="field">
                <span class="field__label">Who can request</span>
                <select id="requests-access-level" class="control-input">
                  <option value="everyone">Everyone</option>
                  <option value="subscriber">Subscribers and above</option>
                  <option value="vip">VIPs and above</option>
                  <option value="moderator">Moderators only</option>
                  <option value="broadcaster">Broadcaster only</option>
                </select>
                <span class="field__hint">Moderators and the broadcaster always bypass request caps.</span>
              </label>
              <label class="field">
                <span class="field__label">Max queued requests</span>
                <input id="requests-max-queue-length" class="control-input" type="number" min="0" step="1" />
                <span class="field__hint">Set to 0 for no queue-length cap.</span>
              </label>
              <label class="field">
                <span class="field__label">Max active requests per user</span>
                <input id="requests-max-per-user" class="control-input" type="number" min="0" step="1" />
                <span class="field__hint">Counts queued, playing, and stopped queue tracks. Set to 0 for no per-user cap.</span>
              </label>
              <label class="field">
                <span class="field__label">Recent duplicate window (tracks)</span>
                <input id="requests-duplicate-history-count" class="control-input" type="number" min="0" step="1" />
                <span class="field__hint">Set to 0 to allow repeats from history. Higher values reject tracks that appeared in the most recent playback history entries.</span>
              </label>
            </div>
            <div class="request-limit-grid">
              <label class="field">
                <span class="field__label">Per-user cooldown (seconds)</span>
                <input id="requests-cooldown-seconds" class="control-input" type="number" min="0" step="1" />
                <span class="field__hint">Set to 0 to disable the cooldown between successful requests from the same viewer.</span>
              </label>
              <label class="field">
                <span class="field__label">Max track duration (seconds)</span>
                <input id="requests-max-duration-seconds" class="control-input" type="number" min="0" step="1" />
                <span class="field__hint">Set to 0 for no duration cap. Duration checks apply when provider metadata exposes a track length.</span>
              </label>
              <label class="toggle-card" for="requests-allow-search-toggle">
                <span class="toggle-card__copy">
                  <span class="toggle-card__title">Allow text-search requests</span>
                  <span class="toggle-card__body">If disabled, chat requests must use direct YouTube, SoundCloud, Spotify, or Suno links.</span>
                </span>
                <input id="requests-allow-search-toggle" type="checkbox" />
              </label>
            </div>
            <div class="request-limit-grid">
              <label class="toggle-card" for="requests-reject-live-toggle">
                <span class="toggle-card__copy">
                  <span class="toggle-card__title">Block live streams</span>
                  <span class="toggle-card__body">Reject live or upcoming YouTube streams before they can enter the request queue.</span>
                </span>
                <input id="requests-reject-live-toggle" type="checkbox" />
              </label>
              <label class="field">
                <span class="field__label">YouTube safe search</span>
                <select id="requests-safe-search" class="control-input">
                  <option value="none">None</option>
                  <option value="moderate">Moderate</option>
                  <option value="strict">Strict</option>
                </select>
                <span class="field__hint">Used for chat search requests only. Direct links are still allowed.</span>
              </label>
            </div>
            <div class="request-limit-grid">
              <fieldset class="field fieldset-card">
                <legend class="field__label">Allowed providers</legend>
                <label class="checkbox-row">
                  <input id="requests-provider-youtube" type="checkbox" />
                  <span>YouTube</span>
                </label>
                <label class="checkbox-row">
                  <input id="requests-provider-soundcloud" type="checkbox" />
                  <span>SoundCloud</span>
                </label>
                <label class="checkbox-row">
                  <input id="requests-provider-spotify" type="checkbox" />
                  <span>Spotify</span>
                </label>
                <label class="checkbox-row">
                  <input id="requests-provider-suno" type="checkbox" />
                  <span>Suno</span>
                </label>
              </fieldset>
              <label class="field">
                <span class="field__label">Blocked usernames</span>
                <textarea id="requests-blocked-users" class="control-input control-input--multiline" rows="4" placeholder="viewerone&#10;viewertwo"></textarea>
                <span class="field__hint">One username per line. Matching is case-insensitive.</span>
              </label>
            </div>
            <div class="request-limit-grid">
              <label class="field">
                <span class="field__label">Blocked YouTube channels</span>
                <textarea id="requests-blocked-youtube-channels" class="control-input control-input--multiline" rows="4" placeholder="UC1234567890abcdef&#10;@channelhandle&#10;https://www.youtube.com/@channelhandle"></textarea>
                <span class="field__hint">Use a channel ID, handle, custom path, or channel URL. Matching is case-insensitive.</span>
              </label>
              <label class="field">
                <span class="field__label">Blocked SoundCloud users</span>
                <textarea id="requests-blocked-soundcloud-users" class="control-input control-input--multiline" rows="4" placeholder="artistname&#10;https://soundcloud.com/artistname"></textarea>
                <span class="field__hint">Use the profile URL, username slug, or author name you want to block.</span>
              </label>
            </div>
            <div class="request-limit-grid">
              <label class="field">
                <span class="field__label">Blocked direct-link domains</span>
                <textarea id="requests-blocked-domains" class="control-input control-input--multiline" rows="4" placeholder="youtube.com&#10;youtu.be"></textarea>
                <span class="field__hint">Use one hostname per line. Direct links from matching domains or subdomains are rejected before they can be queued.</span>
              </label>
              <label class="field field--full">
                <span class="field__label">Blocked phrases</span>
                <textarea id="requests-blocked-phrases" class="control-input control-input--multiline" rows="4" placeholder="artist name&#10;banned phrase"></textarea>
                <span class="field__hint">If a chat request contains one of these phrases, it is rejected before it can be queued.</span>
              </label>
            </div>
            <p id="requests-feedback" class="feedback" role="status" aria-live="polite"></p>
          </section>

          <section class="panel card-panel">
            <div class="panel__header">
              <div>
                <p class="panel__eyebrow">Chat commands</p>
                <h2>Reconfigure command triggers</h2>
              </div>
            </div>
            <div class="playlist-table-wrap">
              <table class="playlist-table command-table">
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

      <section id="tab-settings" class="atlas-view" hidden>
        <form id="settings-form" class="stack-layout">
          <section class="panel card-panel">
            <div class="panel__header">
              <div>
                <p class="panel__eyebrow">Twitch login</p>
                <h2>Connect the bot account</h2>
              </div>
              <div class="button-row">
                <button id="twitch-auth-start" class="secondary-button" type="button">Connect bot with Twitch</button>
                <button id="twitch-auth-cancel" class="ghost-button" type="button">Cancel</button>
              </div>
            </div>
            <p id="twitch-auth-status-text" class="panel-note">Use the bundled Twitch Client ID to start the in-app bot login flow.</p>
            <div id="twitch-auth-details" class="detail-grid" hidden>
              <div class="detail-card">
                <span class="detail-card__label">Activation code</span>
                <div class="copy-row">
                  <input id="twitch-auth-code" class="control-input" type="text" readonly />
                  <button class="copy-row__button" type="button" data-copy-target="twitch-auth-code">Copy</button>
                </div>
              </div>
              <div class="detail-card">
                <span class="detail-card__label">Verification page</span>
                <div class="copy-row copy-row--triple">
                  <input id="twitch-auth-url" class="control-input" type="text" readonly />
                  <button class="copy-row__button" type="button" data-open-url-target="twitch-auth-url">Open</button>
                  <button class="copy-row__button" type="button" data-copy-target="twitch-auth-url">Copy</button>
                </div>
              </div>
            </div>
          </section>
          <div class="atlas-grid atlas-grid--connection">
            <section class="panel card-panel">
              <div class="panel__header">
                <div>
                  <p class="panel__eyebrow">Credentials</p>
                  <h2>Manual entry</h2>
                </div>
              </div>
              <div class="form-grid">
                <label class="field">
                  <span class="field__label">Twitch channel</span>
                  <input id="twitchChannel" name="twitchChannel" class="control-input" type="text" autocomplete="off" />
                  <span class="field__hint">Usually the streamer name without #.</span>
                </label>
                <label class="field">
                  <span class="field__label">Bot username</span>
                  <input id="twitchUsername" name="twitchUsername" class="control-input" type="text" autocomplete="off" />
                  <span class="field__hint">The Twitch account that joins chat.</span>
                </label>
                <label class="field field--full">
                  <span class="field__label">Bot OAuth token</span>
                  <input id="twitchOauthToken" name="twitchOauthToken" class="control-input" type="password" autocomplete="off" />
                  <span class="field__hint">Manual tokens should keep the oauth: prefix and include chat scopes. <a class="field__link" href="https://dev.twitch.tv/docs/irc/authenticate-bot" target="_blank" rel="noopener noreferrer">How to get this token</a></span>
                </label>
                <label class="field">
                  <span class="field__label">Twitch Client ID</span>
                  <input id="twitchClientId" name="twitchClientId" class="control-input" type="text" autocomplete="off" />
                  <span class="field__hint">Used for Twitch API calls. Leave bundled value unless using your own Twitch app.</span>
                </label>
                <label class="field">
                  <span class="field__label">Twitch Client Secret</span>
                  <input id="twitchClientSecret" name="twitchClientSecret" class="control-input" type="password" autocomplete="off" />
                  <span class="field__hint">Needed only for source-only Shared Chat messages.</span>
                </label>
                <label class="toggle-card field--full" for="twitch-shared-chat-source-only-toggle">
                  <span class="toggle-card__copy">
                    <span class="toggle-card__title">Source-only Shared Chat messages</span>
                    <span class="toggle-card__body">Bot replies stay in the configured channel during Shared Chat. Requires a Twitch Client Secret and updated bot login scopes.</span>
                  </span>
                  <input id="twitch-shared-chat-source-only-toggle" type="checkbox" />
                </label>
                <label class="field field--full">
                  <span class="field__label">YouTube API key</span>
                  <input id="youtubeApiKey" name="youtubeApiKey" class="control-input" type="password" autocomplete="off" />
                  <span class="field__hint">Only needed when viewers request tracks by search terms instead of direct links.</span>
                </label>
                <label class="field field--narrow">
                  <span class="field__label">Local port</span>
                  <input id="port" name="port" class="control-input" type="number" min="1" max="65535" />
                  <span class="field__hint">Used for the local dashboard and OBS overlay URL.</span>
                </label>
              </div>
            </section>
            <section class="panel card-panel">
              <div class="panel__header">
                <div>
                  <p class="panel__eyebrow">Category rules</p>
                  <h2>Suppression</h2>
                </div>
              </div>
              <div class="rule-grid">
                <article class="rule-card">
                  <p class="rule-card__title">Suppress chat messages</p>
                  <p class="rule-card__body">The bot stops sending replies and now-playing messages for these categories.</p>
                  <div class="copy-row copy-row--triple">
                    <input id="chat-category-input" class="control-input" type="text" placeholder="Add category" />
                    <button id="chat-category-add" class="copy-row__button" type="button">Add</button>
                    <button id="chat-category-delete" class="copy-row__button" type="button">Delete</button>
                  </div>
                  <label class="field">
                    <span class="field__label">Configured categories</span>
                    <select id="chat-category-select" class="control-input"></select>
                  </label>
                </article>
                <article class="rule-card">
                  <p class="rule-card__title">Suppress music playback</p>
                  <p class="rule-card__body">Playback stops completely while the stream sits in one of these categories.</p>
                  <div class="copy-row copy-row--triple">
                    <input id="playback-category-input" class="control-input" type="text" placeholder="Add category" />
                    <button id="playback-category-add" class="copy-row__button" type="button">Add</button>
                    <button id="playback-category-delete" class="copy-row__button" type="button">Delete</button>
                  </div>
                  <label class="field">
                    <span class="field__label">Configured categories</span>
                    <select id="playback-category-select" class="control-input"></select>
                  </label>
                </article>
              </div>
            </section>
          </div>
          <section class="panel card-panel">
            <div class="panel__header">
              <div>
                <p class="panel__eyebrow">Desktop</p>
                <h2>Windows startup</h2>
              </div>
            </div>
            <div class="request-policy-row">
              <label class="toggle-card" for="start-with-windows-toggle">
                <span class="toggle-card__copy">
                  <span class="toggle-card__title">Start with Windows</span>
                  <span id="start-with-windows-copy" class="toggle-card__body">Launch the desktop app automatically when you sign in to Windows.</span>
                </span>
                <input id="start-with-windows-toggle" type="checkbox" />
              </label>
            </div>
            <p id="start-with-windows-note" class="panel-note">Only available in the packaged Windows desktop app.</p>
          </section>
          <section class="panel card-panel">
            <div class="panel__header">
              <div>
                <p class="panel__eyebrow">Diagnostics</p>
                <h2>Export a runtime snapshot</h2>
              </div>
              <button id="export-diagnostics-button" class="secondary-button" type="button">Export diagnostics</button>
            </div>
            <p class="panel-note">Downloads the current settings, runtime status, playback state, history, and admin activity as JSON for debugging.</p>
          </section>
        </form>
      </section>

      <section id="tab-library" class="atlas-view" hidden>
        <section class="panel card-panel library-review-panel">
          <div class="panel__header">
            <div>
              <p class="panel__eyebrow">Health review</p>
              <h2>Flagged library tracks</h2>
            </div>
            <div class="status-strip status-strip--compact">
              <span id="playlist-review-flagged-count" class="status-pill status-pill--warn">0 flagged</span>
              <span id="playlist-review-total-failures" class="status-pill status-pill--idle">0 failures</span>
            </div>
          </div>
          <p class="panel-note">Saved tracks that fail playback or metadata refreshes stay here until they recover or are removed.</p>
          <div id="playlist-review-list" class="history-list"></div>
        </section>

        <section class="panel card-panel playlist-panel">
          <div class="panel__header panel__header--playlist">
            <div>
              <p class="panel__eyebrow">Playlist</p>
              <h2>Fallback track library</h2>
            </div>
          </div>
          <div class="playlist-tools">
            <form id="playlist-add-form" class="playlist-add-form">
              <input id="playlist-add-input" class="control-input" type="text" placeholder="YouTube / SoundCloud / Spotify / Suno URL or search text" autocomplete="off" />
              <button id="playlist-add-button" class="primary-button" type="submit">Add to playlist</button>
            </form>
            <div class="playlist-tools__body">
              <div class="playlist-tools__actions">
                <div class="button-row button-row--wrap">
                  <button id="playlist-import-append" class="secondary-button" type="button">Import and append CSV</button>
                  <button id="playlist-import-replace" class="ghost-button" type="button">Replace from CSV</button>
                  <button id="playlist-export-button" class="secondary-button" type="button">Export CSV</button>
                </div>
                <div class="button-row button-row--wrap">
                  <button id="playlist-bulk-queue-button" class="secondary-button" type="button">Queue selected</button>
                  <button id="playlist-export-selected-button" class="secondary-button" type="button">Export selected</button>
                  <button id="playlist-bulk-delete-button" class="ghost-button ghost-button--danger" type="button">Delete selected</button>
                </div>
              </div>
              <div class="library-toolbar library-toolbar--right">
                <div class="library-toolbar__grid">
                  <label class="control-field">
                    <span class="control-field__label">Search</span>
                    <input id="playlist-search-input" class="control-input" type="search" placeholder="Title, link, or provider" autocomplete="off" />
                  </label>
                  <label class="control-field">
                    <span class="control-field__label">Sort</span>
                    <select id="playlist-sort-select" class="control-input">
                      <option value="recent">Recently added</option>
                      <option value="title">Title</option>
                      <option value="provider">Provider</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
          </div>
          <p id="playlist-feedback" class="feedback" role="status" aria-live="polite"></p>
          <input id="playlist-import-file" type="file" accept=".csv,text/csv" hidden />
          <div class="library-summary">
            <span id="playlist-count">0 tracks</span>
            <span id="playlist-page-info">Page 1 of 1</span>
          </div>
          <div class="playlist-table-wrap">
            <table class="playlist-table">
              <thead>
                <tr>
                  <th scope="col" class="playlist-table__checkbox">
                    <input id="playlist-select-page" type="checkbox" />
                  </th>
                  <th scope="col">Title</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Link</th>
                  <th scope="col" class="playlist-table__actions">Action</th>
                </tr>
              </thead>
              <tbody id="playlist-table-body"></tbody>
            </table>
            <div id="playlist-empty-state" class="empty-state" hidden>No playlist tracks matched this search.</div>
          </div>
          <div class="pagination-row">
            <button id="playlist-prev-page" class="ghost-button" type="button">Previous</button>
            <button id="playlist-next-page" class="ghost-button" type="button">Next</button>
          </div>
        </section>
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
  feedback.className = "feedback";
  if (tone) {
    feedback.classList.add(`is-${tone}`);
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
  ["overview", "playback", "queue", "requests", "settings", "library"].forEach((tabId) => {
    const button = root.querySelector(`[data-tab="${tabId}"]`);
    const view = el(`tab-${tabId}`);
    const isActive = activeTab === tabId;
    if (button) {
      button.classList.toggle("is-active", isActive);
    }
    if (view) {
      view.hidden = !isActive;
    }
  });
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
function collectSettingsPayload() {
  return {
    twitchChannel: el("twitchChannel")?.value.trim() || "",
    twitchUsername: el("twitchUsername")?.value.trim() || "",
    twitchOauthToken: el("twitchOauthToken")?.value.trim() || "",
    twitchClientId: el("twitchClientId")?.value.trim() || "",
    twitchClientSecret: el("twitchClientSecret")?.value.trim() || "",
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
    requestPolicyAutosaveEnabled: getRequestPolicyAutosaveEnabled(),
    requestPolicy: collectRequestPolicyPayload(),
    chatCommands: collectChatCommandsPayload(),
    theme: el("theme-select")?.value || lastSavedTheme,
    chatSuppressedCategories,
    playbackSuppressedCategories
  };
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
  isHydratingForm = true;
  requestPolicyDraft = null;
  renderThemeOptions(settingsPayload.settings.theme);
  renderOverlayScaleControl(settingsPayload.settings.overlayScalePercent);
  setValue("twitchChannel", settingsPayload.settings.twitchChannel || "");
  setValue("twitchUsername", settingsPayload.settings.twitchUsername || "");
  setValue("twitchOauthToken", settingsPayload.settings.twitchOauthToken || "");
  setValue("twitchClientId", settingsPayload.settings.twitchClientId || "");
  setValue("twitchClientSecret", settingsPayload.settings.twitchClientSecret || "");
  const sharedChatSourceOnlyToggle = el("twitch-shared-chat-source-only-toggle");
  if (sharedChatSourceOnlyToggle instanceof HTMLInputElement) {
    sharedChatSourceOnlyToggle.checked = settingsPayload.settings.twitchSharedChatForSourceOnly === true;
  }
  setValue("youtubeApiKey", settingsPayload.settings.youtubeApiKey || "");
  setValue("port", settingsPayload.settings.port || 3e3);
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
  applyRequestPolicyState();
  applyRuntimeState();
  applyGuiPlayerState();
  isHydratingForm = false;
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
    startWithWindowsNote.textContent = desktopIntegration?.supported === true ? desktopIntegration.enabled === true ? "Windows will launch the desktop app automatically at sign-in." : "Disabled. Turn this on and save settings to register the app with Windows startup." : desktopIntegration?.reason || "Only available in the packaged Windows desktop app.";
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
    const row = document.createElement("tr");
    const isBusy = queueActionTrackId === track.id;
    row.innerHTML = `
      <td>
        <strong>${htmlEscape(track.title)}</strong>
        <div class="command-table__description">#${index + 1} in queue</div>
      </td>
      <td>${htmlEscape(requester)}</td>
      <td><span class="provider-chip">${htmlEscape(track.provider)}</span></td>
      <td class="playlist-table__actions queue-table__actions">
        <div class="button-row button-row--compact">
          <button class="ghost-button" type="button" data-queue-action="move-up" data-queue-track-id="${htmlEscape(track.id)}" ${isBusy || index === 0 ? "disabled" : ""}>Up</button>
          <button class="ghost-button" type="button" data-queue-action="move-down" data-queue-track-id="${htmlEscape(track.id)}" ${isBusy || index === queue.length - 1 ? "disabled" : ""}>Down</button>
          <button class="ghost-button" type="button" data-queue-action="promote" data-queue-track-id="${htmlEscape(track.id)}" ${isBusy ? "disabled" : ""}>Move to top</button>
          <button class="ghost-button ghost-button--danger" type="button" data-queue-action="remove" data-queue-track-id="${htmlEscape(track.id)}" ${isBusy ? "disabled" : ""}>Remove</button>
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
        <span class="provider-chip">${htmlEscape(historyStatusLabel(entry.status))}</span>
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
        <span class="provider-chip">${htmlEscape(entry.action)}</span>
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
  const playbackTabPill = el("playback-tab-pill");
  const pillState = playbackPillState(playbackStatus);
  setText("current-track-title", visibleTrack?.title || "Waiting for a track");
  setText("current-track-meta", describePlaybackMeta({
    currentTrack,
    stoppedTrack,
    playbackStatus,
    queueLength: queue.length
  }));
  setText("playback-tab-title", visibleTrack?.title || "Waiting for a track");
  setText("playback-tab-meta", describePlaybackMeta({
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
  if (playbackTabPill) {
    playbackTabPill.className = pillState.className;
    playbackTabPill.textContent = pillState.text;
  }
  const playPauseButton = el("overview-play-pause");
  const stopButton = el("overview-stop");
  const nextButton = el("overview-next");
  const queueButton = el("overview-queue-button");
  const searchButton = el("overview-search-button");
  const restartStoppedButton = el("playback-restart-stopped");
  if (playPauseButton) {
    playPauseButton.disabled = isPlaybackCommandPending;
    playPauseButton.textContent = playbackStatus === "playing" ? "Pause" : "Play";
  }
  if (stopButton) {
    stopButton.disabled = isPlaybackCommandPending || playbackStatus === "idle";
  }
  if (nextButton) {
    nextButton.disabled = isPlaybackCommandPending;
  }
  if (queueButton) {
    queueButton.disabled = isQueueSubmitting || isOverviewSearchPending;
  }
  if (searchButton) {
    searchButton.disabled = isQueueSubmitting || isOverviewSearchPending;
  }
  if (restartStoppedButton) {
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
    queue.slice(0, 4).forEach((track) => {
      const requester = track.requestedBy?.displayName || track.requestedBy?.username || "playlist";
      const item = document.createElement("li");
      item.innerHTML = `<span class="queue-preview__title">${htmlEscape(track.title)}</span><span class="queue-preview__meta">${htmlEscape(requester)}</span>`;
      queueList.appendChild(item);
    });
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
        <button class="secondary-button" type="button" data-overview-search-add-index="${index}">Add</button>
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
        <div class="button-row button-row--compact library-review-actions">
          <button class="ghost-button" type="button" data-playlist-review-action="queue" data-playlist-review-key="${htmlEscape(track.key)}">Queue</button>
          <button class="ghost-button" type="button" data-playlist-review-action="refresh" data-playlist-review-key="${htmlEscape(track.key)}">Refresh</button>
          <button class="ghost-button ghost-button--danger" type="button" data-playlist-review-action="delete" data-playlist-review-key="${htmlEscape(track.key)}">Delete</button>
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
    row.innerHTML = `
      <td class="playlist-table__checkbox">
        <input type="checkbox" data-playlist-select-key="${htmlEscape(track.key)}" ${playlistSelectedKeys.has(track.key) ? "checked" : ""} />
      </td>
      <td>
        <div class="library-track-heading">
          <strong>${htmlEscape(track.title)}</strong>
          ${isFlagged ? '<span class="status-pill status-pill--warn library-flag-pill">Flagged</span>' : ""}
        </div>
        <div class="command-table__description">${htmlEscape(track.key)}</div>
        ${healthSummary}
      </td>
      <td><span class="provider-chip">${htmlEscape(track.provider)}</span></td>
      <td><a class="playlist-link" href="${htmlEscape(track.url)}" target="_blank" rel="noopener noreferrer">${htmlEscape(track.url)}</a></td>
      <td class="playlist-table__actions playlist-table__actions--wide">
        <div class="button-row button-row--compact playlist-row-actions">
          <button class="ghost-button" type="button" data-playlist-edit-key="${htmlEscape(track.key)}" data-playlist-title="${htmlEscape(track.title)}">Edit</button>
          <button class="ghost-button" type="button" data-playlist-refresh-key="${htmlEscape(track.key)}">Refresh</button>
          <button class="ghost-button ghost-button--danger" type="button" data-playlist-delete-key="${htmlEscape(track.key)}">Delete</button>
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
async function persistSettings(payload) {
  return fetchJson("/api/settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
async function saveSettings(event) {
  event?.preventDefault?.();
  clearRequestPolicyAutosaveTimer();
  hasPendingRequestPolicyAutosave = false;
  isSavingSettings = true;
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
    settingsPayload = await persistSettings(collectSettingsPayload());
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
      setFeedback("Settings saved. Restart the app to switch to the new port.", "warning");
    } else if (settingsPayload.saveSummary?.botReconnected) {
      setFeedback("Settings saved and Twitch chat was reconnected.", "success");
    } else {
      setFeedback("Settings saved.", "success");
    }
  } catch (error) {
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
    applyRequestAutosaveState();
    if (hasPendingRequestPolicyAutosave && getRequestPolicyAutosaveEnabled()) {
      hasPendingRequestPolicyAutosave = false;
      scheduleRequestPolicyAutosave(true);
    }
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
        requestPolicyAutosaveEnabled ? "Request autosave is on. Request changes now save automatically." : "Request autosave is off. Use Save settings to keep request changes.",
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
        requestPolicyAutosaveEnabled ? "Request autosave is on. Request changes now save automatically." : "Request autosave is off. Use Save settings to keep request changes.",
        "success"
      );
    } else {
      setRequestsFeedback("Request controls saved.", "success");
    }
  } catch (error) {
    setRequestsFeedback(error?.message || "Could not save request controls.", "error");
  } finally {
    isRequestPolicyAutosaveSaving = false;
    applyRequestAutosaveState();
    if (hasPendingRequestPolicyAutosave && getRequestPolicyAutosaveEnabled()) {
      hasPendingRequestPolicyAutosave = false;
      scheduleRequestPolicyAutosave(true);
    }
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
async function startTwitchAuth() {
  setFeedback("Starting Twitch login...");
  try {
    settingsPayload = await fetchJson("/api/twitch-auth/device/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        twitchChannel: el("twitchChannel")?.value.trim() || "",
        twitchClientId: el("twitchClientId")?.value.trim() || settingsPayload?.settings?.twitchClientId || "",
        twitchClientSecret: el("twitchClientSecret")?.value.trim() || settingsPayload?.settings?.twitchClientSecret || ""
      })
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
async function sendOverviewPlaybackCommand(url) {
  isPlaybackCommandPending = true;
  applyPlaybackState();
  try {
    const payload = await fetchJson(url, {
      method: "POST"
    });
    playbackState = payload.state;
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
function formatMarkdown(text) {
  if (!text) {
    return "";
  }
  return text.replace(/^# (.*$)/gm, "<h1>$1</h1>").replace(/^## (.*$)/gm, "<h2>$1</h2>").replace(/^### (.*$)/gm, "<h3>$1</h3>").replace(/^\* (.*$)/gm, "<li>$1</li>").replace(/^- (.*$)/gm, "<li>$1</li>").replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>").replace(/<\/ul>\s*<ul>/g, "");
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
  if (!(event.target instanceof Element)) {
    return;
  }
  const tabButton = event.target.closest("[data-tab]");
  if (tabButton) {
    activeTab = tabButton.getAttribute("data-tab") || "overview";
    applyTabState();
    if (activeTab === "library") {
      void loadPlaylist().catch((error) => setPlaylistFeedback(error?.message || "Could not load playlist.", "error"));
    }
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
  } else if (event.target.id === "overview-search-button") {
    void searchOverviewTracks();
  } else if (event.target.id === "playback-restart-stopped") {
    void restartStoppedTrack();
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
  if (target.id === "playlist-sort-select" && target instanceof HTMLSelectElement) {
    playlistSortBy = target.value || "recent";
    playlistPage = 1;
    await loadPlaylist();
  }
  if (target.id === "requests-enabled-toggle" && target instanceof HTMLInputElement) {
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
void Promise.all([loadSettings(), loadPlaybackState(), loadPlaylist()]).catch((error) => {
  setFeedback(error?.message || "Could not load dashboard data.", "error");
});
