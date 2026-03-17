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
let lastTwitchAuthState = "";
let chatSuppressedCategories = [];
let playbackSuppressedCategories = [];
let playlistPage = 1;
let playlistTotalPages = 1;
let playlistQuery = "";
let playlistSearchDebounceTimer = null;
let playlistImportMode = "append";
let settingsPayload = null;
let playbackState = null;
let playlistPayload = null;
let activeTab = "overview";
let isQueueSubmitting = false;
let isPlaybackCommandPending = false;
let isGuiPlayerSaving = false;
let guiPlayerVolume = 100;
let guiPlayerVolumeSaveTimer = null;
let isGuiPlayerVolumeSaving = false;
let queueActionTrackId = "";

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
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
            <button id="open-appdata-button" class="secondary-button" type="button">Open Settings Folder</button>
            <button id="save-button" class="primary-button" type="button">Save settings</button>
          </div>
        </div>
      </header>

      <p id="save-feedback" class="feedback" role="status" aria-live="polite"></p>

      <nav class="atlas-tabs" aria-label="Dashboard sections">
        <button class="tab-button" type="button" data-tab="overview">Overview</button>
        <button class="tab-button" type="button" data-tab="queue">Queue</button>
        <button class="tab-button" type="button" data-tab="requests">Requests</button>
        <button class="tab-button" type="button" data-tab="connection">Connection</button>
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
              <div class="playback-controls">
                <button id="overview-play-pause" class="primary-button" type="button">Play</button>
                <button id="overview-stop" class="secondary-button" type="button">Stop</button>
                <button id="overview-next" class="ghost-button" type="button">Next track</button>
              </div>
              <form id="overview-queue-form" class="queue-add-form">
                <input id="overview-queue-input" class="control-input" type="text" placeholder="YouTube / SoundCloud URL or search text" autocomplete="off" />
                <button id="overview-queue-button" class="secondary-button" type="submit">Add to queue</button>
              </form>
              <p id="overview-feedback" class="feedback" role="status" aria-live="polite"></p>
              <ul id="queue-preview" class="queue-preview"></ul>
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
            </div>
          </section>
        </div>
      </section>

      <section id="tab-queue" class="atlas-view" hidden>
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
      </section>

      <section id="tab-requests" class="atlas-view" hidden>
        <div class="stack-layout">
          <section class="panel card-panel">
            <div class="panel__header">
              <div>
                <p class="panel__eyebrow">Requests</p>
                <h2>Viewer request controls</h2>
              </div>
              <span id="requests-tab-pill" class="status-pill status-pill--idle">Requests loading</span>
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

      <section id="tab-connection" class="atlas-view" hidden>
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
        </form>
      </section>

      <section id="tab-library" class="atlas-view" hidden>
        <section class="panel card-panel playlist-panel">
          <div class="panel__header panel__header--playlist">
            <div>
              <p class="panel__eyebrow">Playlist</p>
              <h2>Fallback track library</h2>
            </div>
            <div class="library-toolbar">
              <label class="control-field">
                <span class="control-field__label">Search</span>
                <input id="playlist-search-input" class="control-input" type="search" placeholder="Title, link, or provider" autocomplete="off" />
              </label>
            </div>
          </div>
          <div class="playlist-tools">
            <form id="playlist-add-form" class="playlist-add-form">
              <input id="playlist-add-input" class="control-input" type="text" placeholder="YouTube / SoundCloud URL or search text" autocomplete="off" />
              <button id="playlist-add-button" class="primary-button" type="submit">Add to playlist</button>
            </form>
            <div class="button-row button-row--wrap">
              <button id="playlist-import-append" class="secondary-button" type="button">Import and append CSV</button>
              <button id="playlist-import-replace" class="ghost-button" type="button">Replace from CSV</button>
              <button id="playlist-export-button" class="secondary-button" type="button">Export CSV</button>
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
  ["overview", "queue", "requests", "connection", "library"].forEach((tabId) => {
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

function getRequestPolicy() {
  return settingsPayload?.settings?.requestPolicy ?? {
    requestsEnabled: true
  };
}

function requestStatusPresentation(isEnabled) {
  return isEnabled
    ? {
        className: "status-pill status-pill--ok",
        text: "Requests open",
        copy: "Viewer requests can be queued from chat."
      }
    : {
        className: "status-pill status-pill--warn",
        text: "Requests closed",
        copy: "Only moderators and the broadcaster can add requests from chat."
      };
}

function applyRequestPolicyState() {
  const toggle = el("requests-enabled-toggle");
  const isEnabled = toggle instanceof HTMLInputElement && !isHydratingForm
    ? toggle.checked
    : getRequestPolicy().requestsEnabled !== false;
  const presentation = requestStatusPresentation(isEnabled);
  const headerPill = el("requests-status-pill");
  const tabPill = el("requests-tab-pill");
  const statusCopy = el("requests-status-copy");

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
          aliases: aliasesInput instanceof HTMLInputElement
            ? aliasesInput.value.split(",").map((value) => value.trim()).filter(Boolean)
            : [],
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
    youtubeApiKey: el("youtubeApiKey")?.value.trim() || "",
    port: Number.parseInt(el("port")?.value || "3000", 10) || 3000,
    guiPlayerEnabled: settingsPayload?.settings?.guiPlayerEnabled === true,
    guiPlayerVolume,
    requestPolicy: {
      requestsEnabled: el("requests-enabled-toggle") instanceof HTMLInputElement
        ? el("requests-enabled-toggle").checked
        : true
    },
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
  chatSuppressedCategories = Array.isArray(settingsPayload.settings.chatSuppressedCategories)
    ? [...settingsPayload.settings.chatSuppressedCategories]
    : [];
  playbackSuppressedCategories = Array.isArray(settingsPayload.settings.playbackSuppressedCategories)
    ? [...settingsPayload.settings.playbackSuppressedCategories]
    : [];
  guiPlayerVolume = Number.isFinite(settingsPayload.settings.guiPlayerVolume)
    ? settingsPayload.settings.guiPlayerVolume
    : 100;

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
  renderThemeOptions(settingsPayload.settings.theme);
  setValue("twitchChannel", settingsPayload.settings.twitchChannel || "");
  setValue("twitchUsername", settingsPayload.settings.twitchUsername || "");
  setValue("twitchOauthToken", settingsPayload.settings.twitchOauthToken || "");
  setValue("youtubeApiKey", settingsPayload.settings.youtubeApiKey || "");
  setValue("port", settingsPayload.settings.port || 3000);
  renderCategorySelect("chat-category-select", chatSuppressedCategories);
  renderCategorySelect("playback-category-select", playbackSuppressedCategories);
  renderChatCommandRows(settingsPayload.settings.chatCommands || {});
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
      text: categoryLookup?.categoryName
        ? `Category ${categoryLookup.categoryName}`
        : "Category OK"
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

  const { runtime, twitchStatus, twitchAuthStatus } = settingsPayload;
  const statusState = twitchStatus?.state || "needs_configuration";
  const twitchPill = el("twitch-status-pill");
  const categoryPill = el("twitch-category-pill");
  const categoryStatus = categoryBadgeState(twitchStatus?.categoryLookup);

  setText("server-port-pill", `Port ${runtime.activePort}`);
  setText("twitch-status-text", twitchStatus?.message || "Waiting for configuration.");
  setValue("overlay-url", runtime.overlayUrl || "");

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
    authDetails.hidden = !((twitchAuthStatus?.userCode || "") || (twitchAuthStatus?.verificationUriComplete || twitchAuthStatus?.verificationUri || ""));
  }

  const authCancel = el("twitch-auth-cancel");
  const authStart = el("twitch-auth-start");
  if (authCancel) {
    authCancel.disabled = twitchAuthStatus?.state !== "pending";
  }
  if (authStart) {
    authStart.disabled = isSavingSettings;
    authStart.textContent = twitchAuthStatus?.state === "pending"
      ? "Restart Twitch login"
      : "Connect bot with Twitch";
  }

  if (twitchAuthStatus?.state === "success" && lastTwitchAuthState !== "success") {
    void loadSettings().catch(() => {});
  }
  lastTwitchAuthState = twitchAuthStatus?.state || "";
  applyRequestPolicyState();
  applyGuiPlayerState();
}

function guiPlayerStatusText(isEnabled) {
  return isEnabled
    ? "Active. The desktop app is hosting the same player view locally, even if OBS is closed."
    : "Inactive. Activate it to play inside the desktop app without OBS.";
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
    guiPlayerVolume = Number.isFinite(settingsPayload.settings.guiPlayerVolume)
      ? settingsPayload.settings.guiPlayerVolume
      : normalizedVolume;
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
    return playbackStatus === "paused"
      ? `${requesterText} • Paused`
      : requesterText;
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
    const requester = track.requestedBy?.displayName || track.requestedBy?.username || "playlist";
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
          <button class="ghost-button" type="button" data-queue-action="promote" data-queue-track-id="${htmlEscape(track.id)}" ${isBusy ? "disabled" : ""}>Move to top</button>
          <button class="ghost-button ghost-button--danger" type="button" data-queue-action="remove" data-queue-track-id="${htmlEscape(track.id)}" ${isBusy ? "disabled" : ""}>Remove</button>
        </div>
      </td>
    `;
    tableBody.appendChild(row);
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

  if (playbackPill) {
    playbackPill.className = pillState.className;
    playbackPill.textContent = pillState.text;
  }

  const playPauseButton = el("overview-play-pause");
  const stopButton = el("overview-stop");
  const nextButton = el("overview-next");
  const queueButton = el("overview-queue-button");

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
    queueButton.disabled = isQueueSubmitting;
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
    return;
  }

  queue.slice(0, 4).forEach((track) => {
    const requester = track.requestedBy?.displayName || track.requestedBy?.username || "playlist";
    const item = document.createElement("li");
    item.innerHTML = `<span class="queue-preview__title">${htmlEscape(track.title)}</span><span class="queue-preview__meta">${htmlEscape(requester)}</span>`;
    queueList.appendChild(item);
  });

  renderFullQueue(queue);
}

async function loadPlaylist() {
  const params = new URLSearchParams({
    page: String(playlistPage),
    pageSize: "100"
  });

  if (playlistQuery) {
    params.set("q", playlistQuery);
  }

  playlistPayload = await fetchJson(`/api/playlist/tracks?${params.toString()}`);
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
  const tableBody = el("playlist-table-body");
  const emptyState = el("playlist-empty-state");

  if (prevButton) {
    prevButton.disabled = (playlistPayload.page || 1) <= 1;
  }
  if (nextButton) {
    nextButton.disabled = (playlistPayload.page || 1) >= (playlistPayload.totalPages || 1);
  }
  if (emptyState) {
    emptyState.hidden = (playlistPayload.items || []).length > 0;
  }
  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = "";
  (playlistPayload.items || []).forEach((track) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${htmlEscape(track.title)}</td>
      <td><span class="provider-chip">${htmlEscape(track.provider)}</span></td>
      <td><a class="playlist-link" href="${htmlEscape(track.url)}" target="_blank" rel="noopener noreferrer">${htmlEscape(track.url)}</a></td>
      <td class="playlist-table__actions"><button class="ghost-button ghost-button--danger" type="button" data-playlist-delete-key="${htmlEscape(track.key)}">Delete</button></td>
    `;
    tableBody.appendChild(row);
  });

  const searchInput = el("playlist-search-input");
  if (searchInput && searchInput.value !== playlistQuery) {
    searchInput.value = playlistQuery;
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
  isSavingSettings = true;
  const saveButton = el("save-button");
  const themeSelect = el("theme-select");

  if (saveButton) {
    saveButton.disabled = true;
  }
  if (themeSelect) {
    themeSelect.disabled = true;
  }
  setFeedback("Saving settings...");

  try {
    settingsPayload = await persistSettings(collectSettingsPayload());
    availableThemes = Array.isArray(settingsPayload.themeOptions) ? settingsPayload.themeOptions : [];
    lastSavedTheme = settingsPayload.settings.theme || "aurora";
    chatSuppressedCategories = Array.isArray(settingsPayload.settings.chatSuppressedCategories)
      ? [...settingsPayload.settings.chatSuppressedCategories]
      : [];
    playbackSuppressedCategories = Array.isArray(settingsPayload.settings.playbackSuppressedCategories)
      ? [...settingsPayload.settings.playbackSuppressedCategories]
      : [];
    guiPlayerVolume = Number.isFinite(settingsPayload.settings.guiPlayerVolume)
      ? settingsPayload.settings.guiPlayerVolume
      : guiPlayerVolume;
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
  }
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
    guiPlayerVolume = Number.isFinite(settingsPayload.settings.guiPlayerVolume)
      ? settingsPayload.settings.guiPlayerVolume
      : guiPlayerVolume;
    applySettingsPayload();
    setFeedback("Overlay theme saved.", "success");
  } catch (error) {
    renderThemeOptions(lastSavedTheme);
    setFeedback(error?.message || "Could not save overlay theme.", "error");
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
    guiPlayerVolume = Number.isFinite(settingsPayload.settings.guiPlayerVolume)
      ? settingsPayload.settings.guiPlayerVolume
      : guiPlayerVolume;
    applySettingsPayload();
    if (nextValue) {
      window.setTimeout(() => {
        syncGuiPlayerFrameVolume();
      }, 250);
    }
    setOverviewFeedback(
      nextValue
        ? "GUI player activated and will stay on after restart."
        : "GUI player deactivated and will stay off after restart.",
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
        twitchChannel: el("twitchChannel")?.value.trim() || ""
      })
    });
    applySettingsPayload();

    const verificationUrl =
      settingsPayload.twitchAuthStatus?.verificationUriComplete ||
      settingsPayload.twitchAuthStatus?.verificationUri ||
      "";

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
      payload.alreadyExists
        ? `Track already exists in the playlist: ${payload.track.title}`
        : `Added ${payload.track.title} to the playlist.`,
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
    const payload = await fetchJson("/api/queue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ input })
    });

    playbackState = payload.state;
    applyPlaybackState();
    setValue("overview-queue-input", "");

    const duplicateType = payload.track?.duplicateType;
    if (duplicateType === "playing") {
      setOverviewFeedback(`Track is already playing: ${payload.track.title}`, "warning");
    } else if (duplicateType === "queue") {
      setOverviewFeedback(`Track is already queued: ${payload.track.title}`, "warning");
    } else if (duplicateType === "stopped") {
      setOverviewFeedback(`Track is stopped and ready to restart: ${payload.track.title}`, "warning");
    } else {
      setOverviewFeedback(`Added ${payload.track.title} to the queue.`, "success");
    }
  } catch (error) {
    setOverviewFeedback(error?.message || "Could not add track to the queue.", "error");
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

  return text
    .replace(/^# (.*$)/gm, "<h1>$1</h1>")
    .replace(/^## (.*$)/gm, "<h2>$1</h2>")
    .replace(/^### (.*$)/gm, "<h3>$1</h3>")
    .replace(/^\* (.*$)/gm, "<li>$1</li>")
    .replace(/^- (.*$)/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
    .replace(/<\/ul>\s*<ul>/g, "");
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

  if (status.state === "available") {
    updateVersionText.textContent = `Version ${status.version} is now available.`;
    updateReleaseNotes.innerHTML = formatMarkdown(status.releaseNotes);
    updateActionBtn.textContent = "Download Update";
    updateActionBtn.disabled = false;
    updateModal.classList.add("is-visible");
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
  } else {
    updateModal.classList.remove("is-visible");
  }
}

renderDashboard();

root.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const tabButton = event.target.closest("[data-tab]");
  if (tabButton) {
    activeTab = tabButton.getAttribute("data-tab") || "overview";
    applyTabState();
    return;
  }

  const deleteButton = event.target.closest("[data-playlist-delete-key]");
  if (deleteButton) {
    void deletePlaylistTrack(deleteButton.getAttribute("data-playlist-delete-key"));
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

    if (action === "promote") {
      void promoteQueueTrack(trackId);
      return;
    }

    if (action === "remove") {
      void removeQueueTrack(trackId);
      return;
    }
  }

  if (event.target.id === "save-button") {
    void saveSettings();
  } else if (event.target.id === "open-appdata-button") {
    fetch("/api/open-runtime-dir", { method: "POST" }).catch(() => {});
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
  } else if (event.target.id === "queue-clear-button") {
    void clearQueue();
  } else if (event.target.id === "overview-play-pause") {
    void toggleOverviewPlayback();
  } else if (event.target.id === "overview-stop") {
    void stopOverviewPlayback();
  } else if (event.target.id === "overview-next") {
    void playNextOverviewTrack();
  } else if (event.target.id === "overview-gui-player-toggle") {
    void saveGuiPlayerEnabled(!(settingsPayload?.settings?.guiPlayerEnabled === true));
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

  if (target.id === "requests-enabled-toggle" && target instanceof HTMLInputElement) {
    applyRequestPolicyState();
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
});

updateSkipBtn.addEventListener("click", () => {
  updateModal.classList.remove("is-visible");
});

updateActionBtn.addEventListener("click", () => {
  const buttonText = updateActionBtn.textContent;
  if (buttonText === "Download Update" || buttonText === "Try Again") {
    fetch("/api/updater/download", { method: "POST" }).catch(() => {});
  } else if (buttonText === "Restart and Install") {
    fetch("/api/updater/install", { method: "POST" }).catch(() => {});
  }
});

fetch("/api/updater")
  .then((response) => response.json())
  .then(handleUpdaterStatus)
  .catch(() => {});

if (socket) {
  socket.on("app:updater-status", handleUpdaterStatus);
}

window.setInterval(() => {
  void loadPlaybackState().catch(() => {});
}, 3000);

window.setInterval(() => {
  if (!isSavingSettings && !isHydratingForm && settingsPayload) {
    void fetchJson("/api/runtime-status")
      .then((payload) => {
        settingsPayload = {
          ...settingsPayload,
          runtime: payload.runtime,
          twitchStatus: payload.twitchStatus,
          twitchAuthStatus: payload.twitchAuthStatus
        };
        applyRuntimeState();
      })
      .catch(() => {});
  }
}, 3000);

void Promise.all([loadSettings(), loadPlaybackState(), loadPlaylist()]).catch((error) => {
  setFeedback(error?.message || "Could not load dashboard data.", "error");
});
