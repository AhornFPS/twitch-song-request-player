const socket = typeof window.io === "function" ? window.io() : null;

const body = document.body;
const settingsForm = document.getElementById("settings-form");
const saveButton = document.getElementById("save-button");
const saveFeedback = document.getElementById("save-feedback");
const themeSelect = document.getElementById("theme-select");
const themeDescription = document.getElementById("theme-description");
const dashboardLayoutSelect = document.getElementById("dashboard-layout-select");
const dashboardLayoutDescription = document.getElementById("dashboard-layout-description");
const twitchStatusPill = document.getElementById("twitch-status-pill");
const serverPortPill = document.getElementById("server-port-pill");
const twitchStatusText = document.getElementById("twitch-status-text");
const overlayUrlInput = document.getElementById("overlay-url");
const restartNote = document.getElementById("restart-note");
const currentTrackTitle = document.getElementById("current-track-title");
const currentTrackMeta = document.getElementById("current-track-meta");
const queuePreview = document.getElementById("queue-preview");
const openAppdataButton = document.getElementById("open-appdata-button");
const twitchAuthStartButton = document.getElementById("twitch-auth-start");
const twitchAuthCancelButton = document.getElementById("twitch-auth-cancel");
const twitchAuthStatusText = document.getElementById("twitch-auth-status-text");
const twitchAuthDetails = document.getElementById("twitch-auth-details");
const twitchAuthCodeInput = document.getElementById("twitch-auth-code");
const twitchAuthUrlInput = document.getElementById("twitch-auth-url");
const appVersionBadge = document.getElementById("app-version-badge");
const chatCategoryInput = document.getElementById("chat-category-input");
const chatCategoryAddButton = document.getElementById("chat-category-add");
const chatCategoryDeleteButton = document.getElementById("chat-category-delete");
const chatCategorySelect = document.getElementById("chat-category-select");
const playbackCategoryInput = document.getElementById("playback-category-input");
const playbackCategoryAddButton = document.getElementById("playback-category-add");
const playbackCategoryDeleteButton = document.getElementById("playback-category-delete");
const playbackCategorySelect = document.getElementById("playback-category-select");
const playlistAddForm = document.getElementById("playlist-add-form");
const playlistAddInput = document.getElementById("playlist-add-input");
const playlistAddButton = document.getElementById("playlist-add-button");
const playlistFeedback = document.getElementById("playlist-feedback");
const playlistSearchInput = document.getElementById("playlist-search-input");
const playlistTableBody = document.getElementById("playlist-table-body");
const playlistEmptyState = document.getElementById("playlist-empty-state");
const playlistCount = document.getElementById("playlist-count");
const playlistPageInfo = document.getElementById("playlist-page-info");
const playlistPrevPageButton = document.getElementById("playlist-prev-page");
const playlistNextPageButton = document.getElementById("playlist-next-page");
const playlistImportAppendButton = document.getElementById("playlist-import-append");
const playlistImportReplaceButton = document.getElementById("playlist-import-replace");
const playlistExportButton = document.getElementById("playlist-export-button");
const playlistImportFileInput = document.getElementById("playlist-import-file");
const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));

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
let availableDashboardLayouts = [];
let lastSavedTheme = "aurora";
let lastSavedDashboardLayout = "atlas";
let lastTwitchAuthState = "";
let chatSuppressedCategories = [];
let playbackSuppressedCategories = [];
let playlistPage = 1;
let playlistTotalPages = 1;
let playlistQuery = "";
let playlistSearchDebounceTimer = null;
let playlistImportMode = "append";

const fields = {
  twitchChannel: document.getElementById("twitchChannel"),
  twitchUsername: document.getElementById("twitchUsername"),
  twitchOauthToken: document.getElementById("twitchOauthToken"),
  youtubeApiKey: document.getElementById("youtubeApiKey"),
  port: document.getElementById("port")
};

function setFeedback(message, tone = "") {
  saveFeedback.textContent = message;
  saveFeedback.className = "feedback";

  if (tone) {
    saveFeedback.classList.add(`is-${tone}`);
  }
}

function setPlaylistFeedback(message, tone = "") {
  playlistFeedback.textContent = message;
  playlistFeedback.className = "feedback";

  if (tone) {
    playlistFeedback.classList.add(`is-${tone}`);
  }
}

function activateTab(tabId) {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === tabId;
    button.classList.toggle("is-active", isActive);
  });

  document.querySelectorAll(".workspace-view").forEach((view) => {
    const isActive = view.id === `tab-${tabId}`;
    view.classList.toggle("is-active", isActive);
    view.hidden = !isActive;
  });
}

function fillSettingsForm(settings) {
  fields.twitchChannel.value = settings.twitchChannel || "";
  fields.twitchUsername.value = settings.twitchUsername || "";
  fields.twitchOauthToken.value = settings.twitchOauthToken || "";
  fields.youtubeApiKey.value = settings.youtubeApiKey || "";
  fields.port.value = settings.port || 3000;
  chatSuppressedCategories = Array.isArray(settings.chatSuppressedCategories)
    ? [...settings.chatSuppressedCategories]
    : [];
  playbackSuppressedCategories = Array.isArray(settings.playbackSuppressedCategories)
    ? [...settings.playbackSuppressedCategories]
    : [];
  renderCategorySelect(chatCategorySelect, chatSuppressedCategories);
  renderCategorySelect(playbackCategorySelect, playbackSuppressedCategories);
}

function syncThemeSelection(selectedTheme) {
  if (themeSelect) {
    themeSelect.value = selectedTheme || "aurora";
  }

  const selectedOption =
    availableThemes.find((theme) => theme.id === (selectedTheme || "aurora")) || availableThemes[0];

  if (themeDescription) {
    themeDescription.textContent = selectedOption?.description || "";
  }
}

function syncDashboardLayoutSelection(selectedLayout) {
  const nextLayout = selectedLayout || "atlas";

  if (dashboardLayoutSelect) {
    dashboardLayoutSelect.value = nextLayout;
  }

  body.dataset.dashboardLayout = nextLayout;
  const selectedOption =
    availableDashboardLayouts.find((layout) => layout.id === nextLayout) || availableDashboardLayouts[0];

  if (dashboardLayoutDescription) {
    dashboardLayoutDescription.textContent = selectedOption?.description || "";
  }
}

function renderThemeOptions(themeOptions, selectedTheme) {
  availableThemes = Array.isArray(themeOptions) ? themeOptions : [];
  themeSelect.innerHTML = "";

  availableThemes.forEach((theme) => {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.label;
    themeSelect.appendChild(option);
  });

  syncThemeSelection(selectedTheme);
}

function renderDashboardLayoutOptions(layoutOptions, selectedLayout) {
  availableDashboardLayouts = Array.isArray(layoutOptions) ? layoutOptions : [];
  dashboardLayoutSelect.innerHTML = "";

  availableDashboardLayouts.forEach((layout) => {
    const option = document.createElement("option");
    option.value = layout.id;
    option.textContent = layout.label;
    dashboardLayoutSelect.appendChild(option);
  });

  syncDashboardLayoutSelection(selectedLayout);
}

function getSelectedTheme() {
  return themeSelect?.value || "aurora";
}

function getSelectedDashboardLayout() {
  return dashboardLayoutSelect?.value || "atlas";
}

function describeRequester(track) {
  const requester = track?.requestedBy?.displayName || track?.requestedBy?.username;
  return requester ? `Requested by ${requester}` : "Fallback playlist track";
}

function updatePlaybackState(state) {
  const currentTrack = state.currentTrack;
  const queue = state.queue || [];

  currentTrackTitle.textContent = currentTrack?.title || "Waiting for a track";
  currentTrackMeta.textContent = currentTrack
    ? describeRequester(currentTrack)
    : "Queue is empty. Fallback playlist will play automatically.";

  queuePreview.innerHTML = "";

  queue.slice(0, 4).forEach((track) => {
    const item = document.createElement("li");
    const requester = track.requestedBy?.displayName || track.requestedBy?.username || "playlist";
    const title = document.createElement("span");
    title.className = "queue-preview__title";
    title.textContent = track.title;

    const meta = document.createElement("span");
    meta.className = "queue-preview__meta";
    meta.textContent = requester;

    item.append(title, meta);
    queuePreview.appendChild(item);
  });
}

function updateRuntimePanel(payload) {
  const { runtime, twitchStatus, twitchAuthStatus } = payload;
  const statusState = twitchStatus?.state || "needs_configuration";

  overlayUrlInput.value = runtime.overlayUrl;
  serverPortPill.textContent = `Port ${runtime.activePort}`;
  twitchStatusText.textContent = twitchStatus?.message || "Waiting for configuration.";

  twitchStatusPill.className = "status-pill";
  if (statusState === "connected") {
    twitchStatusPill.classList.add("status-pill--ok");
    twitchStatusPill.textContent = "Connected";
  } else if (statusState === "error") {
    twitchStatusPill.classList.add("status-pill--error");
    twitchStatusPill.textContent = "Error";
  } else if (statusState === "connecting") {
    twitchStatusPill.classList.add("status-pill--warn");
    twitchStatusPill.textContent = "Connecting";
  } else {
    twitchStatusPill.classList.add("status-pill--idle");
    twitchStatusPill.textContent = "Setup needed";
  }

  if (runtime.pendingRestart) {
    if (runtime.usingFallbackPort) {
      restartNote.textContent = `Configured port ${runtime.configuredPort} was unavailable at startup, so the app is currently using fallback port ${runtime.activePort}.`;
    } else {
      restartNote.textContent = `Saved port ${fields.port.value || runtime.activePort} will be used after restart. The current server is still running on port ${runtime.activePort}.`;
    }
  } else {
    restartNote.textContent = "Port changes are applied immediately when you restart the app.";
  }

  updateTwitchAuthPanel(twitchAuthStatus);
}

function renderSettingsPayload(payload) {
  isHydratingForm = true;
  fillSettingsForm(payload.settings);
  renderThemeOptions(payload.themeOptions, payload.settings.theme);
  renderDashboardLayoutOptions(payload.dashboardLayoutOptions, payload.settings.dashboardLayout);
  lastSavedTheme = payload.settings.theme || "aurora";
  lastSavedDashboardLayout = payload.settings.dashboardLayout || "atlas";
  updateRuntimePanel(payload);
  isHydratingForm = false;
}

function collectSettingsPayload() {
  return {
    twitchChannel: fields.twitchChannel.value.trim(),
    twitchUsername: fields.twitchUsername.value.trim(),
    twitchOauthToken: fields.twitchOauthToken.value.trim(),
    chatSuppressedCategories,
    playbackSuppressedCategories,
    youtubeApiKey: fields.youtubeApiKey.value.trim(),
    port: Number.parseInt(fields.port.value, 10) || 3000,
    theme: getSelectedTheme(),
    dashboardLayout: getSelectedDashboardLayout()
  };
}

function normalizeCategoryName(value) {
  return String(value || "").trim();
}

function renderCategorySelect(select, items) {
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

function addCategory(listName, input, select) {
  const normalized = normalizeCategoryName(input.value);

  if (!normalized) {
    return;
  }

  const currentList = listName === "chat"
    ? chatSuppressedCategories
    : playbackSuppressedCategories;
  const alreadyExists = currentList.some((item) => item.toLowerCase() === normalized.toLowerCase());

  if (alreadyExists) {
    input.value = "";
    setFeedback(`Category ${normalized} is already configured.`, "warning");
    return;
  }

  const nextList = [...currentList, normalized];

  if (listName === "chat") {
    chatSuppressedCategories = nextList;
  } else {
    playbackSuppressedCategories = nextList;
  }

  renderCategorySelect(select, nextList);
  select.value = normalized;
  input.value = "";
}

function deleteSelectedCategory(listName, select) {
  const selectedValue = select.value;

  if (!selectedValue) {
    return;
  }

  if (listName === "chat") {
    chatSuppressedCategories = chatSuppressedCategories.filter((item) => item !== selectedValue);
    renderCategorySelect(chatCategorySelect, chatSuppressedCategories);
    return;
  }

  playbackSuppressedCategories = playbackSuppressedCategories.filter((item) => item !== selectedValue);
  renderCategorySelect(playbackCategorySelect, playbackSuppressedCategories);
}

function updateTwitchAuthPanel(authStatus) {
  const statusState = authStatus?.state || "idle";
  const verificationUrl = authStatus?.verificationUriComplete || authStatus?.verificationUri || "";
  const userCode = authStatus?.userCode || "";

  twitchAuthStatusText.textContent =
    authStatus?.message ||
    "Use the bundled Twitch Client ID to start the in-app bot login flow.";
  twitchAuthCodeInput.value = userCode;
  twitchAuthUrlInput.value = verificationUrl;
  twitchAuthDetails.hidden = !(verificationUrl || userCode);
  twitchAuthCancelButton.disabled = statusState !== "pending";
  twitchAuthStartButton.disabled = isSavingSettings;
  twitchAuthStartButton.textContent = statusState === "pending"
    ? "Restart Twitch login"
    : "Connect bot with Twitch";

  if (statusState === "success" && lastTwitchAuthState !== "success") {
    void loadSettings().catch(() => {});
  }

  lastTwitchAuthState = statusState;
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
  const payload = await fetchJson("/api/settings");
  renderSettingsPayload(payload);
}

async function loadRuntimeStatus() {
  const payload = await fetchJson("/api/runtime-status");
  updateRuntimePanel(payload);
}

async function loadPlaybackState() {
  const state = await fetchJson("/api/state");
  updatePlaybackState(state);
}

async function loadPlaylist() {
  const searchParams = new URLSearchParams({
    page: String(playlistPage),
    pageSize: "100"
  });

  if (playlistQuery) {
    searchParams.set("q", playlistQuery);
  }

  const payload = await fetchJson(`/api/playlist/tracks?${searchParams.toString()}`);
  playlistTotalPages = payload.totalPages || 1;
  playlistPage = payload.page || 1;
  renderPlaylist(payload);
}

function renderPlaylist(payload) {
  playlistTableBody.innerHTML = "";

  const tracks = Array.isArray(payload.items) ? payload.items : [];
  const total = Number.isFinite(payload.total) ? payload.total : tracks.length;
  const totalPages = Number.isFinite(payload.totalPages) ? payload.totalPages : 1;

  playlistCount.textContent = `${total.toLocaleString()} tracks`;
  playlistPageInfo.textContent = `Page ${payload.page} of ${totalPages}`;
  playlistPrevPageButton.disabled = payload.page <= 1;
  playlistNextPageButton.disabled = payload.page >= totalPages;
  playlistEmptyState.hidden = tracks.length > 0;

  tracks.forEach((track) => {
    const row = document.createElement("tr");

    const titleCell = document.createElement("td");
    titleCell.textContent = track.title;

    const providerCell = document.createElement("td");
    providerCell.innerHTML = `<span class="provider-chip">${track.provider}</span>`;

    const linkCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = track.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "playlist-link";
    link.textContent = track.url;
    linkCell.appendChild(link);

    const actionCell = document.createElement("td");
    actionCell.className = "playlist-table__actions";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "ghost-button ghost-button--danger";
    deleteButton.dataset.playlistDeleteKey = track.key;
    deleteButton.textContent = "Delete";
    actionCell.appendChild(deleteButton);

    row.append(titleCell, providerCell, linkCell, actionCell);
    playlistTableBody.appendChild(row);
  });
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
  event.preventDefault();
  isSavingSettings = true;
  saveButton.disabled = true;
  themeSelect.disabled = true;
  dashboardLayoutSelect.disabled = true;
  setFeedback("Saving settings...");

  try {
    const payload = await persistSettings(collectSettingsPayload());
    renderSettingsPayload(payload);

    if (payload.saveSummary?.restartRequired) {
      setFeedback("Settings saved. Restart the app to switch to the new port.", "warning");
    } else if (payload.saveSummary?.botReconnected) {
      setFeedback("Settings saved and Twitch chat was reconnected.", "success");
    } else {
      setFeedback("Settings saved.", "success");
    }
  } catch (error) {
    setFeedback(error?.message || "Could not save settings.", "error");
  } finally {
    isSavingSettings = false;
    saveButton.disabled = false;
    themeSelect.disabled = false;
    dashboardLayoutSelect.disabled = false;
  }
}

async function saveDisplayPreference(settingKey, nextValue, previousValue, successMessage) {
  if (!nextValue || nextValue === previousValue) {
    return previousValue;
  }

  isSavingSettings = true;
  saveButton.disabled = true;
  themeSelect.disabled = true;
  dashboardLayoutSelect.disabled = true;
  setFeedback("Saving display preference...");

  try {
    const payload = await persistSettings({
      [settingKey]: nextValue
    });

    renderSettingsPayload(payload);
    setFeedback(successMessage, "success");
    return payload.settings?.[settingKey] || nextValue;
  } catch (error) {
    setFeedback(error?.message || "Could not save display preference.", "error");
    return previousValue;
  } finally {
    isSavingSettings = false;
    saveButton.disabled = false;
    themeSelect.disabled = false;
    dashboardLayoutSelect.disabled = false;
  }
}

async function copyFieldValue(targetId) {
  const target = document.getElementById(targetId);
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
  const target = document.getElementById(targetId);
  const url = target?.value?.trim();

  if (!url) {
    return;
  }

  window.open(url, "_blank", "noopener");
}

async function startTwitchAuth() {
  twitchAuthStartButton.disabled = true;
  setFeedback("Starting Twitch login...");

  try {
    const payload = await fetchJson("/api/twitch-auth/device/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        twitchChannel: fields.twitchChannel.value.trim()
      })
    });

    renderSettingsPayload(payload);
    const verificationUrl =
      payload.twitchAuthStatus?.verificationUriComplete ||
      payload.twitchAuthStatus?.verificationUri ||
      "";

    if (verificationUrl) {
      window.open(verificationUrl, "_blank", "noopener");
    }

    setFeedback("Twitch login started. Approve the bot account in your browser.", "success");
  } catch (error) {
    setFeedback(error?.message || "Could not start Twitch login.", "error");
  } finally {
    twitchAuthStartButton.disabled = false;
  }
}

async function cancelTwitchAuth() {
  try {
    const payload = await fetchJson("/api/twitch-auth/device/cancel", {
      method: "POST"
    });
    updateTwitchAuthPanel(payload.twitchAuthStatus);
    setFeedback("Twitch login cancelled.", "warning");
  } catch (error) {
    setFeedback(error?.message || "Could not cancel Twitch login.", "error");
  }
}

async function addPlaylistTrack(event) {
  event.preventDefault();
  const input = playlistAddInput.value.trim();

  if (!input) {
    return;
  }

  playlistAddButton.disabled = true;
  setPlaylistFeedback("Adding track...");

  try {
    const payload = await fetchJson("/api/playlist/tracks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input
      })
    });

    playlistAddInput.value = "";
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
    playlistAddButton.disabled = false;
  }
}

async function deletePlaylistTrack(trackKey) {
  if (!trackKey) {
    return;
  }

  if (!window.confirm("Delete this track from the fallback playlist?")) {
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
    setPlaylistFeedback(
      `Import finished: ${payload.importedCount} added, ${payload.duplicateCount} duplicates skipped, ${payload.finalCount} total.`,
      "success"
    );
  } catch (error) {
    setPlaylistFeedback(error?.message || "Could not import playlist.", "error");
  }
}

function formatMarkdown(text) {
  if (!text) {
    return "";
  }

  let html = text
    .replace(/^# (.*$)/gm, "<h1>$1</h1>")
    .replace(/^## (.*$)/gm, "<h2>$1</h2>")
    .replace(/^### (.*$)/gm, "<h3>$1</h3>")
    .replace(/^\* (.*$)/gm, "<li>$1</li>")
    .replace(/^- (.*$)/gm, "<li>$1</li>");

  html = html.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");
  html = html.replace(/<\/ul>\s*<ul>/g, "");
  return html;
}

function handleUpdaterStatus(status) {
  if (status.appVersion) {
    appVersionBadge.textContent = `v${status.appVersion}`;
    appVersionBadge.className = "status-pill status-pill--ok";
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

settingsForm.addEventListener("submit", saveSettings);
playlistAddForm.addEventListener("submit", addPlaylistTrack);

themeSelect.addEventListener("change", async (event) => {
  if (!(event.target instanceof HTMLSelectElement)) {
    return;
  }

  syncThemeSelection(event.target.value);

  if (!isHydratingForm) {
    lastSavedTheme = await saveDisplayPreference(
      "theme",
      event.target.value,
      lastSavedTheme,
      "Overlay theme saved."
    );
  }
});

dashboardLayoutSelect.addEventListener("change", async (event) => {
  if (!(event.target instanceof HTMLSelectElement)) {
    return;
  }

  syncDashboardLayoutSelection(event.target.value);

  if (!isHydratingForm) {
    lastSavedDashboardLayout = await saveDisplayPreference(
      "dashboardLayout",
      event.target.value,
      lastSavedDashboardLayout,
      "GUI look saved."
    );
  }
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tabTarget || "overview");
  });
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

openAppdataButton.addEventListener("click", () => {
  fetch("/api/open-runtime-dir", { method: "POST" }).catch(() => {});
});

twitchAuthStartButton.addEventListener("click", () => {
  void startTwitchAuth();
});

twitchAuthCancelButton.addEventListener("click", () => {
  void cancelTwitchAuth();
});

chatCategoryAddButton.addEventListener("click", () => {
  addCategory("chat", chatCategoryInput, chatCategorySelect);
});

chatCategoryDeleteButton.addEventListener("click", () => {
  deleteSelectedCategory("chat", chatCategorySelect);
});

playbackCategoryAddButton.addEventListener("click", () => {
  addCategory("playback", playbackCategoryInput, playbackCategorySelect);
});

playbackCategoryDeleteButton.addEventListener("click", () => {
  deleteSelectedCategory("playback", playbackCategorySelect);
});

chatCategoryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addCategory("chat", chatCategoryInput, chatCategorySelect);
  }
});

playbackCategoryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addCategory("playback", playbackCategoryInput, playbackCategorySelect);
  }
});

playlistSearchInput.addEventListener("input", () => {
  window.clearTimeout(playlistSearchDebounceTimer);
  playlistSearchDebounceTimer = window.setTimeout(() => {
    playlistQuery = playlistSearchInput.value.trim();
    playlistPage = 1;
    void loadPlaylist().catch((error) => {
      setPlaylistFeedback(error?.message || "Could not load playlist.", "error");
    });
  }, 180);
});

playlistPrevPageButton.addEventListener("click", () => {
  playlistPage = Math.max(1, playlistPage - 1);
  void loadPlaylist().catch((error) => {
    setPlaylistFeedback(error?.message || "Could not load playlist.", "error");
  });
});

playlistNextPageButton.addEventListener("click", () => {
  playlistPage = Math.min(playlistTotalPages, playlistPage + 1);
  void loadPlaylist().catch((error) => {
    setPlaylistFeedback(error?.message || "Could not load playlist.", "error");
  });
});

playlistImportAppendButton.addEventListener("click", () => {
  playlistImportMode = "append";
  playlistImportFileInput.value = "";
  playlistImportFileInput.click();
});

playlistImportReplaceButton.addEventListener("click", () => {
  if (!window.confirm("Replace the entire fallback playlist with the CSV you select?")) {
    return;
  }

  playlistImportMode = "replace";
  playlistImportFileInput.value = "";
  playlistImportFileInput.click();
});

playlistExportButton.addEventListener("click", () => {
  void exportPlaylist();
});

playlistImportFileInput.addEventListener("change", async () => {
  const file = playlistImportFileInput.files?.[0];

  if (!file) {
    return;
  }

  setPlaylistFeedback("Importing playlist...");

  try {
    const csvText = await file.text();
    await importPlaylist(csvText);
  } catch (error) {
    setPlaylistFeedback(error?.message || "Could not read import file.", "error");
  } finally {
    playlistImportFileInput.value = "";
  }
});

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const deleteButton = event.target.closest("[data-playlist-delete-key]");
  if (deleteButton) {
    void deletePlaylistTrack(deleteButton.getAttribute("data-playlist-delete-key"));
    return;
  }

  const copyButton = event.target.closest("[data-copy-target]");
  if (copyButton) {
    const targetId = copyButton.getAttribute("data-copy-target");
    if (targetId) {
      void copyFieldValue(targetId);
      return;
    }
  }

  const openButton = event.target.closest("[data-open-url-target]");
  if (openButton) {
    const targetId = openButton.getAttribute("data-open-url-target");
    if (targetId) {
      openFieldValue(targetId);
    }
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
  if (isSavingSettings || isHydratingForm) {
    return;
  }

  void loadRuntimeStatus().catch(() => {});
}, 3000);

void Promise.all([
  loadSettings(),
  loadPlaybackState(),
  loadPlaylist()
]).catch((error) => {
  setFeedback(error?.message || "Could not load dashboard data.", "error");
});
