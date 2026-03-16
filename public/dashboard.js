const settingsForm = document.getElementById("settings-form");
const saveButton = document.getElementById("save-button");
const saveFeedback = document.getElementById("save-feedback");
const themeSelect = document.getElementById("theme-select");
const themeDescription = document.getElementById("theme-description");
const twitchStatusPill = document.getElementById("twitch-status-pill");
const serverPortPill = document.getElementById("server-port-pill");
const twitchStatusText = document.getElementById("twitch-status-text");
const overlayUrlInput = document.getElementById("overlay-url");
const restartNote = document.getElementById("restart-note");
const currentTrackTitle = document.getElementById("current-track-title");
const currentTrackMeta = document.getElementById("current-track-meta");
const queuePreview = document.getElementById("queue-preview");
const twitchAuthStartButton = document.getElementById("twitch-auth-start");
const twitchAuthCancelButton = document.getElementById("twitch-auth-cancel");
const twitchAuthStatusText = document.getElementById("twitch-auth-status-text");
const twitchAuthDetails = document.getElementById("twitch-auth-details");
const twitchAuthCodeInput = document.getElementById("twitch-auth-code");
const twitchAuthUrlInput = document.getElementById("twitch-auth-url");
let isSavingSettings = false;
let isHydratingForm = false;
let availableThemes = [];
let lastTwitchAuthState = "";

const fields = {
  twitchChannel: document.getElementById("twitchChannel"),
  twitchUsername: document.getElementById("twitchUsername"),
  twitchOauthToken: document.getElementById("twitchOauthToken"),
  twitchClientId: document.getElementById("twitchClientId"),
  twitchClientSecret: document.getElementById("twitchClientSecret"),
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

function fillSettingsForm(settings) {
  fields.twitchChannel.value = settings.twitchChannel || "";
  fields.twitchUsername.value = settings.twitchUsername || "";
  fields.twitchOauthToken.value = settings.twitchOauthToken || "";
  fields.twitchClientId.value = settings.twitchClientId || "";
  fields.twitchClientSecret.value = settings.twitchClientSecret || "";
  fields.youtubeApiKey.value = settings.youtubeApiKey || "";
  fields.port.value = settings.port || 3000;
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

function getSelectedTheme() {
  return themeSelect?.value || "aurora";
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

    item.appendChild(title);
    item.appendChild(meta);
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
    restartNote.textContent = `Saved port ${fields.port.value || runtime.activePort} will be used after restart. The current server is still running on port ${runtime.activePort}.`;
  } else {
    restartNote.textContent = "Port changes are applied immediately when you restart the app.";
  }

  updateTwitchAuthPanel(twitchAuthStatus);
}

function renderSettingsPayload(payload) {
  isHydratingForm = true;
  fillSettingsForm(payload.settings);
  renderThemeOptions(payload.themeOptions, payload.settings.theme);
  updateRuntimePanel(payload);
  isHydratingForm = false;
}

function collectSettingsPayload() {
  return {
    twitchChannel: fields.twitchChannel.value.trim(),
    twitchUsername: fields.twitchUsername.value.trim(),
    twitchOauthToken: fields.twitchOauthToken.value.trim(),
    twitchClientId: fields.twitchClientId.value.trim(),
    twitchClientSecret: fields.twitchClientSecret.value.trim(),
    youtubeApiKey: fields.youtubeApiKey.value.trim(),
    port: Number.parseInt(fields.port.value, 10) || 3000,
    theme: getSelectedTheme()
  };
}

function updateTwitchAuthPanel(authStatus) {
  const statusState = authStatus?.state || "idle";
  const verificationUrl = authStatus?.verificationUriComplete || authStatus?.verificationUri || "";
  const userCode = authStatus?.userCode || "";

  twitchAuthStatusText.textContent = authStatus?.message || "Enter a Twitch Client ID to start the in-app bot login flow.";
  twitchAuthCodeInput.value = userCode;
  twitchAuthUrlInput.value = verificationUrl;
  twitchAuthDetails.hidden = !(verificationUrl || userCode);
  twitchAuthCancelButton.disabled = statusState !== "pending";
  twitchAuthStartButton.disabled = isSavingSettings;

  if (statusState === "pending") {
    twitchAuthStartButton.textContent = "Restart Twitch login";
  } else {
    twitchAuthStartButton.textContent = "Connect bot with Twitch";
  }

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

async function saveSettings(event) {
  event.preventDefault();
  isSavingSettings = true;
  saveButton.disabled = true;
  setFeedback("Saving settings...");

  try {
    const payload = await fetchJson("/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(collectSettingsPayload())
    });

    renderSettingsPayload(payload);

    if (payload.saveSummary?.restartRequired) {
      setFeedback("Settings saved. Twitch changes were applied live. Restart the app to use the new port.", "warning");
    } else if (payload.saveSummary?.botReconnected) {
      setFeedback("Settings saved and Twitch chat was reconnected with the new credentials.", "success");
    } else {
      setFeedback("Settings saved.", "success");
    }
  } catch (error) {
    setFeedback(error?.message || "Could not save settings.", "error");
  } finally {
    isSavingSettings = false;
    saveButton.disabled = false;
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
        twitchChannel: fields.twitchChannel.value.trim(),
        twitchClientId: fields.twitchClientId.value.trim(),
        twitchClientSecret: fields.twitchClientSecret.value.trim()
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

settingsForm.addEventListener("submit", saveSettings);

themeSelect.addEventListener("change", (event) => {
  if (event.target instanceof HTMLSelectElement) {
    syncThemeSelection(event.target.value);

    if (!isHydratingForm) {
      setFeedback("Player theme updated. Save settings to apply it to the OBS overlay.");
    }
  }
});

twitchAuthStartButton.addEventListener("click", () => {
  void startTwitchAuth();
});

twitchAuthCancelButton.addEventListener("click", () => {
  void cancelTwitchAuth();
});

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest("[data-copy-target]");
  if (!button) {
    return;
  }

  const targetId = button.getAttribute("data-copy-target");
  if (targetId) {
    void copyFieldValue(targetId);
    return;
  }

  const openTargetId = button.getAttribute("data-open-url-target");
  if (openTargetId) {
    openFieldValue(openTargetId);
  }
});

window.setInterval(() => {
  void loadPlaybackState().catch(() => {});
}, 3000);

window.setInterval(() => {
  if (isSavingSettings || isHydratingForm) {
    return;
  }

  void loadRuntimeStatus().catch(() => {});
}, 3000);

void Promise.all([loadSettings(), loadPlaybackState()]).catch((error) => {
  setFeedback(error?.message || "Could not load dashboard data.", "error");
});
