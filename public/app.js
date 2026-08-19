function sendClientLog(level, message, details = null) {
  if (typeof window.__playerLog === "function") {
    window.__playerLog(level, message, details);
    return;
  }
  fetch("/api/client-log", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      level,
      message,
      details
    })
  }).catch(() => {
  });
}
const playbackOutputMuted = window.__playbackOutputMuted === true;
const playbackClientRole = (() => {
  try {
    return new URL(window.location.href).searchParams.get("embedded") === "desktop" ? playbackOutputMuted ? "observer" : "desktop" : "obs";
  } catch {
    return "obs";
  }
})();
const socket = typeof window.io === "function" ? window.io({
  auth: {
    playbackClientRole
  }
}) : null;
const youtubeContainer = document.getElementById("youtube-player");
let soundCloudFrame = document.getElementById("soundcloud-player");
const audioElement = document.getElementById("suno-player");
const sunoAudio = audioElement;
const currentTitle = document.getElementById("current-title");
const currentTitleMarquee = document.getElementById("current-title-marquee");
const currentTitleText = document.getElementById("current-title-text");
const currentTitleTextClone = document.getElementById("current-title-text-clone");
const currentMeta = document.getElementById("current-meta");
const queueList = document.getElementById("queue-list");
const queueCount = document.getElementById("queue-count");
const providerBadge = document.getElementById("provider-badge");
const saveBadge = document.getElementById("save-badge");
const playerCard = document.getElementById("player-card");
const artworkImage = document.getElementById("artwork-image");
const artworkFallback = document.getElementById("artwork-fallback");
const nextDeck = document.getElementById("next-deck");
const nextTitle = document.getElementById("next-title");
const nextMeta = document.getElementById("next-meta");
const nextProviderBadge = document.getElementById("next-provider-badge");
const nextArtworkImage = document.getElementById("next-artwork-image");
const nextArtworkFallback = document.getElementById("next-artwork-fallback");
const currentTimeText = document.getElementById("current-time");
const durationTimeText = document.getElementById("duration-time");
const progressFill = document.getElementById("progress-fill");
let currentTrackId = null;
let youtubePlayer = null;
let soundCloudWidget = null;
let pendingYoutubeTrack = null;
let lastReportedStatus = "";
let socketConnected = false;
let statePollTimer = null;
let lastLoggedStateSignature = "";
let lastRenderedQueueSignature = "";
let playbackTimer = null;
let activeTrack = null;
let currentDurationSeconds = 0;
let currentPositionSeconds = 0;
let serverTimelineTrackId = "";
let serverTimelineElapsedSeconds = null;
let serverTimelineDurationSeconds = null;
let serverTimelineSyncedAt = 0;
let serverTimelineIsRunning = false;
let serverTimelinePlaybackRate = 1;
let latestPlayerState = null;
let soundCloudDurationProbeTimer = null;
let soundCloudAutoplayRetryTimer = null;
let soundCloudLoadTimeoutTimer = null;
let soundCloudRecoveryTimer = null;
let youtubeAutoplayRetryTimer = null;
let youtubeStartupWatchdogTimer = null;
let youtubeApiReady = false;
let youtubePlayerReady = false;
let youtubeEndedTrackId = "";
let youtubeStartupRecoveryTrackId = "";
let failedArtworkUrl = "";
let artworkRequestId = 0;
let failedNextArtworkUrl = "";
let nextArtworkRequestId = 0;
let youtubeStartupHardResetAttempts = 0;
let displayedTrackId = null;
let displayedAutoDjTrack = false;
let trackExitTimer = null;
let trackEnterTimer = null;
let titleMarqueeFrame = null;
let titleMarqueeRetryTimer = null;
let desiredPausedState = false;
let handoffSourceTrack = null;
let overlayBuildToken = typeof window.__overlayBuildToken === "string" ? window.__overlayBuildToken : "";
let desiredPlayerVolume = 100;
let startupTimeoutMs = 15e3;
const soundCloudToYoutubeReloadKey = "soundcloud-to-youtube-reload-track";
const consecutiveSoundCloudReloadKey = "consecutive-soundcloud-reload-track";
const youtubeStartupRecoveryStorageKey = "youtube-startup-recovery";
const soundCloudRecoveryDelayMs = 650;
const maxSoundCloudRecoveryAttempts = 1;
function applyOverlayTheme(themeId) {
  document.documentElement.dataset.theme = themeId === "kiosk" ? "aurora" : themeId || "aurora";
}
function reportOverlaySize() {
  try {
    if (!window.parent || window.parent === window) return;
    const card = document.getElementById("player-card");
    if (!card) return;
    void card.offsetHeight;
    const rect = card.getBoundingClientRect();
    window.parent.postMessage({
      type: "tsrp:overlay-size",
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height)
    }, "*");
  } catch (_error) {
  }
}
function startSizeObserver() {
  try {
    const card = document.getElementById("player-card");
    if (!card || !window.ResizeObserver) return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => reportOverlaySize());
    });
    observer.observe(card);
  } catch (_error) {
  }
}
function normalizeOverlayScalePercent(value) {
  const parsedValue = Number.parseInt(String(value ?? 100), 10);
  if (!Number.isFinite(parsedValue)) {
    return 100;
  }
  return Math.min(200, Math.max(50, parsedValue));
}
function applyOverlayScale(scalePercent) {
  const normalizedScale = normalizeOverlayScalePercent(scalePercent);
  const nextScale = String(normalizedScale / 100);
  const currentScale = document.documentElement.style.getPropertyValue("--overlay-scale").trim();
  if (currentScale === nextScale) {
    return false;
  }
  document.documentElement.style.setProperty("--overlay-scale", nextScale);
  return true;
}
function scheduleTitleMarqueeUpdate() {
  if (titleMarqueeFrame) {
    window.cancelAnimationFrame(titleMarqueeFrame);
  }
  titleMarqueeFrame = window.requestAnimationFrame(() => {
    titleMarqueeFrame = null;
    updateTitleMarquee();
  });
}
function scheduleDelayedTitleMarqueeUpdate(delayMs = 180) {
  if (titleMarqueeRetryTimer) {
    window.clearTimeout(titleMarqueeRetryTimer);
  }
  titleMarqueeRetryTimer = window.setTimeout(() => {
    titleMarqueeRetryTimer = null;
    scheduleTitleMarqueeUpdate();
  }, delayMs);
}
function getElementLayoutWidth(element) {
  if (!element) {
    return 0;
  }
  const rectWidth = element.getBoundingClientRect?.().width ?? 0;
  return Math.max(rectWidth, element.clientWidth || 0, element.offsetWidth || 0);
}
function getElementContentWidth(element) {
  if (!element) {
    return 0;
  }
  return Math.max(
    getElementLayoutWidth(element),
    element.scrollWidth || 0
  );
}
function updateTitleMarquee() {
  if (!currentTitle || !currentTitleText || !currentTitleTextClone || !currentTitleMarquee) {
    return;
  }
  currentTitleTextClone.textContent = currentTitleText.textContent;
  const titleWidth = getElementLayoutWidth(currentTitle);
  const textWidth = getElementContentWidth(currentTitleText);
  if (titleWidth <= 0 || textWidth <= 0) {
    scheduleDelayedTitleMarqueeUpdate();
    return;
  }
  const overflowAmount = Math.max(0, textWidth - titleWidth);
  currentTitleMarquee.style.animation = "none";
  currentTitle.classList.remove("is-marquee");
  currentTitle.style.removeProperty("--title-marquee-distance");
  currentTitle.style.removeProperty("--title-marquee-duration");
  void currentTitleMarquee.offsetWidth;
  currentTitleMarquee.style.removeProperty("animation");
  if (overflowAmount <= 8) {
    if (currentTitleText.textContent && textWidth <= titleWidth) {
      scheduleDelayedTitleMarqueeUpdate(320);
    }
    return;
  }
  const gapWidth = 180;
  const travelDistance = textWidth + gapWidth;
  const pixelsPerSecond = 26;
  const durationSeconds = Math.max(12, travelDistance / pixelsPerSecond);
  currentTitle.style.setProperty("--title-marquee-distance", `${travelDistance}px`);
  currentTitle.style.setProperty("--title-marquee-duration", `${durationSeconds}s`);
  currentTitle.classList.add("is-marquee");
}
function formatTime(totalSeconds) {
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
function normalizePlayerVolume(value) {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    return desiredPlayerVolume;
  }
  return Math.min(100, Math.max(0, Math.round(parsedValue)));
}
function normalizeStartupTimeoutSeconds(value) {
  const parsedValue = Number.parseInt(String(value ?? 15), 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 15;
  }
  return parsedValue;
}
function applyStartupTimeoutSetting(value) {
  const timeoutSeconds = normalizeStartupTimeoutSeconds(value);
  startupTimeoutMs = timeoutSeconds > 0 ? timeoutSeconds * 1e3 : 0;
}
function isHtmlAudioPlayer(element) {
  return Boolean(
    element && typeof element === "object" && typeof element.play === "function" && typeof element.pause === "function" && typeof element.load === "function"
  );
}
function applyYouTubeVolume() {
  if (!youtubePlayer) {
    return;
  }
  try {
    const volume = playbackOutputMuted ? 0 : desiredPlayerVolume;
    youtubePlayer.setVolume?.(volume);
    if (volume <= 0) {
      youtubePlayer.mute?.();
    } else {
      youtubePlayer.unMute?.();
    }
  } catch (error) {
    sendClientLog("warn", "Failed to apply YouTube volume", {
      message: error?.message ?? String(error),
      volume: playbackOutputMuted ? 0 : desiredPlayerVolume
    });
  }
}
function applySoundCloudVolume() {
  if (!soundCloudWidget) {
    return;
  }
  try {
    soundCloudWidget.setVolume?.(playbackOutputMuted ? 0 : desiredPlayerVolume);
  } catch (error) {
    sendClientLog("warn", "Failed to apply SoundCloud volume", {
      message: error?.message ?? String(error),
      volume: playbackOutputMuted ? 0 : desiredPlayerVolume
    });
  }
}
function applyAudioElementVolume() {
  if (!isHtmlAudioPlayer(audioElement)) {
    return;
  }
  try {
    const volume = playbackOutputMuted ? 0 : desiredPlayerVolume;
    audioElement.volume = volume / 100;
    audioElement.muted = volume <= 0;
  } catch (error) {
    sendClientLog("warn", "Failed to apply HTML audio volume", {
      message: error?.message ?? String(error),
      volume: playbackOutputMuted ? 0 : desiredPlayerVolume
    });
  }
}
function applyPlayerVolume() {
  applyYouTubeVolume();
  applySoundCloudVolume();
  applyAudioElementVolume();
}
function applySunoVolume() {
  applyAudioElementVolume();
}
function isSunoAudioPlayer(element) {
  return isHtmlAudioPlayer(element);
}
function setPlayerVolume(nextVolume) {
  desiredPlayerVolume = normalizePlayerVolume(nextVolume);
  applyPlayerVolume();
}
function clearServerTimelineState() {
  serverTimelineTrackId = "";
  serverTimelineElapsedSeconds = null;
  serverTimelineDurationSeconds = null;
  serverTimelineSyncedAt = 0;
  serverTimelineIsRunning = false;
  serverTimelinePlaybackRate = 1;
}
function getServerTimelineElapsedSeconds(trackId = currentTrackId) {
  if (!trackId || serverTimelineTrackId !== trackId || !Number.isFinite(serverTimelineElapsedSeconds)) {
    return null;
  }
  let elapsedSeconds = serverTimelineElapsedSeconds;
  if (serverTimelineIsRunning && serverTimelineSyncedAt > 0) {
    elapsedSeconds += (Date.now() - serverTimelineSyncedAt) / 1e3 * serverTimelinePlaybackRate;
  }
  if (Number.isFinite(serverTimelineDurationSeconds) && serverTimelineDurationSeconds > 0) {
    elapsedSeconds = Math.min(elapsedSeconds, serverTimelineDurationSeconds);
  }
  return Math.max(elapsedSeconds, 0);
}
function syncServerTimelineFromTrackState(track) {
  if (!track?.id) {
    clearServerTimelineState();
    return;
  }
  serverTimelineTrackId = track.id;
  serverTimelineElapsedSeconds = Number.isFinite(track.elapsedSeconds) ? Math.max(track.elapsedSeconds, 0) : null;
  serverTimelineDurationSeconds = Number.isFinite(track.durationSeconds) ? Math.max(track.durationSeconds, 0) : null;
  serverTimelineSyncedAt = Date.now();
  serverTimelineIsRunning = track.isPaused !== true;
  serverTimelinePlaybackRate = Number.isFinite(track.playbackRate) && track.playbackRate > 0 ? track.playbackRate : 1;
}
function updateTimeline(currentTimeSeconds, durationSeconds, { allowPositionRegression = true } = {}) {
  let current = Number.isFinite(currentTimeSeconds) ? Math.max(0, currentTimeSeconds) : currentPositionSeconds;
  const serverElapsedSeconds = getServerTimelineElapsedSeconds();
  if (Number.isFinite(serverElapsedSeconds)) {
    current = Math.max(current, serverElapsedSeconds);
  }
  if (!allowPositionRegression) {
    current = Math.max(currentPositionSeconds, current);
  }
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.max(0, durationSeconds) : Number.isFinite(serverTimelineDurationSeconds) && serverTimelineDurationSeconds > 0 ? serverTimelineDurationSeconds : currentDurationSeconds;
  const progress = duration > 0 ? Math.min(100, current / duration * 100) : 0;
  currentPositionSeconds = current;
  currentDurationSeconds = duration;
  currentTimeText.textContent = formatTime(current);
  durationTimeText.textContent = formatTime(duration);
  progressFill.style.width = `${progress}%`;
}
function resetTimeline() {
  clearServerTimelineState();
  currentPositionSeconds = 0;
  currentDurationSeconds = 0;
  updateTimeline(0, 0);
}
function isExternalPlaybackTrack(track) {
  return track?.playbackMode === "external" || track?.playbackProvider === "obs_youtube_fallback";
}
function syncTimelineFromTrackState(track, { resetMissingTiming = false } = {}) {
  if (!track?.id) {
    return;
  }
  syncServerTimelineFromTrackState(track);
  const trackElapsedSeconds = Number.isFinite(track.elapsedSeconds) ? Math.max(track.elapsedSeconds, 0) : null;
  const trackDurationSeconds = Number.isFinite(track.durationSeconds) ? Math.max(track.durationSeconds, 0) : null;
  if (trackElapsedSeconds === null && trackDurationSeconds === null) {
    return;
  }
  const nextElapsedSeconds = trackElapsedSeconds === null ? currentPositionSeconds : resetMissingTiming ? trackElapsedSeconds : Math.max(currentPositionSeconds, trackElapsedSeconds);
  const nextDurationSeconds = trackDurationSeconds ?? currentDurationSeconds;
  updateTimeline(nextElapsedSeconds, nextDurationSeconds);
}
function getExternalPlaybackStartSeconds(track, { resetMissingTiming = false } = {}) {
  const trackElapsedSeconds = Number.isFinite(track?.elapsedSeconds) ? Math.max(track.elapsedSeconds, 0) : null;
  if (resetMissingTiming) {
    return trackElapsedSeconds ?? 0;
  }
  return Math.max(
    currentPositionSeconds,
    trackElapsedSeconds ?? currentPositionSeconds
  );
}
function startExternalPlaybackTimer(track, { resetMissingTiming = false } = {}) {
  stopPlaybackTimer();
  const startedAt = Date.now();
  const startedElapsedSeconds = getExternalPlaybackStartSeconds(track, {
    resetMissingTiming
  });
  const durationSeconds = Number.isFinite(track?.durationSeconds) ? Math.max(track.durationSeconds, 0) : resetMissingTiming ? 0 : currentDurationSeconds;
  updateTimeline(startedElapsedSeconds, durationSeconds);
  playbackTimer = window.setInterval(() => {
    if (!currentTrackId || currentTrackId !== track.id || activeTrack?.id !== track.id || !isExternalPlaybackTrack(activeTrack)) {
      stopPlaybackTimer();
      return;
    }
    let elapsedSeconds = startedElapsedSeconds + (Date.now() - startedAt) / 1e3;
    if (durationSeconds > 0) {
      elapsedSeconds = Math.min(elapsedSeconds, durationSeconds);
    }
    updateTimeline(elapsedSeconds, durationSeconds);
  }, 500);
}
function stopPlaybackTimer() {
  if (!playbackTimer) {
    return;
  }
  window.clearInterval(playbackTimer);
  playbackTimer = null;
}
function stopYouTubeAutoplayRetry() {
  if (!youtubeAutoplayRetryTimer) {
    return;
  }
  window.clearTimeout(youtubeAutoplayRetryTimer);
  youtubeAutoplayRetryTimer = null;
}
function stopYouTubeStartupWatchdog() {
  if (!youtubeStartupWatchdogTimer) {
    return;
  }
  window.clearInterval(youtubeStartupWatchdogTimer);
  youtubeStartupWatchdogTimer = null;
}
function stopSoundCloudAutoplayRetry() {
  if (!soundCloudAutoplayRetryTimer) {
    return;
  }
  window.clearTimeout(soundCloudAutoplayRetryTimer);
  soundCloudAutoplayRetryTimer = null;
}
function stopSoundCloudLoadTimeout() {
  if (!soundCloudLoadTimeoutTimer) {
    return;
  }
  window.clearTimeout(soundCloudLoadTimeoutTimer);
  soundCloudLoadTimeoutTimer = null;
}
function stopSoundCloudRecovery() {
  if (!soundCloudRecoveryTimer) {
    return;
  }
  window.clearTimeout(soundCloudRecoveryTimer);
  soundCloudRecoveryTimer = null;
}
function scheduleYouTubeAutoplayRetry(videoId, attempt) {
  if (attempt >= 8) {
    stopYouTubeAutoplayRetry();
    return;
  }
  stopYouTubeAutoplayRetry();
  youtubeAutoplayRetryTimer = window.setTimeout(() => {
    forceYoutubePlayback(videoId, attempt + 1);
  }, 900);
}
function stopSoundCloudDurationProbe() {
  if (!soundCloudDurationProbeTimer) {
    return;
  }
  window.clearInterval(soundCloudDurationProbeTimer);
  soundCloudDurationProbeTimer = null;
}
function scheduleSoundCloudAutoplayRetry(trackId, attempt) {
  if (attempt >= 8) {
    stopSoundCloudAutoplayRetry();
    sendClientLog("warn", "Stopping SoundCloud autoplay retries", {
      trackId,
      attempts: attempt
    });
    return;
  }
  stopSoundCloudAutoplayRetry();
  soundCloudAutoplayRetryTimer = window.setTimeout(() => {
    forceSoundCloudPlayback(trackId, attempt + 1);
  }, 900);
}
function scheduleSoundCloudLoadTimeout(track) {
  stopSoundCloudLoadTimeout();
  if (startupTimeoutMs <= 0) {
    return;
  }
  soundCloudLoadTimeoutTimer = window.setTimeout(() => {
    if (!track?.id || currentTrackId !== track.id || activeTrack?.provider !== "soundcloud" || activeTrack?.id !== track.id) {
      return;
    }
    stopSoundCloudAutoplayRetry();
    stopSoundCloudDurationProbe();
    const resource = getSoundCloudWidgetResource(track);
    sendClientLog("error", "SoundCloud track load timed out", {
      trackId: track.id,
      title: track.title,
      resourceKind: resource.kind,
      privateResource: resource.privateResource
    });
    reportClientError("This SoundCloud track could not be played in the embedded player.");
    emitStatus("error", {
      reason: "soundcloud_load_timeout",
      resourceKind: resource.kind,
      privateResource: resource.privateResource
    });
  }, startupTimeoutMs);
}
function getPendingSoundCloudToYoutubeReloadTrackId() {
  try {
    return window.sessionStorage.getItem(soundCloudToYoutubeReloadKey);
  } catch {
    return "";
  }
}
function setPendingSoundCloudToYoutubeReloadTrackId(trackId) {
  try {
    window.sessionStorage.setItem(soundCloudToYoutubeReloadKey, trackId);
  } catch {
  }
}
function clearPendingSoundCloudToYoutubeReloadTrackId(trackId = "") {
  try {
    const pendingTrackId = window.sessionStorage.getItem(soundCloudToYoutubeReloadKey);
    if (!pendingTrackId) {
      return;
    }
    if (!trackId || pendingTrackId === trackId) {
      window.sessionStorage.removeItem(soundCloudToYoutubeReloadKey);
    }
  } catch {
  }
}
function reloadPageForSoundCloudToYoutubeHandoff(track) {
  setPendingSoundCloudToYoutubeReloadTrackId(track.id);
  sendClientLog("warn", "Reloading page for SoundCloud to YouTube handoff", {
    trackId: track.id,
    title: track.title
  });
  const reloadUrl = new URL(window.location.href);
  reloadUrl.searchParams.set("handoffReload", String(Date.now()));
  window.location.replace(reloadUrl.toString());
}
function getPendingConsecutiveSoundCloudReloadTrackId() {
  try {
    return window.sessionStorage.getItem(consecutiveSoundCloudReloadKey);
  } catch {
    return "";
  }
}
function setPendingConsecutiveSoundCloudReloadTrackId(trackId) {
  try {
    window.sessionStorage.setItem(consecutiveSoundCloudReloadKey, trackId);
  } catch {
  }
}
function clearPendingConsecutiveSoundCloudReloadTrackId(trackId = "") {
  try {
    const pendingTrackId = window.sessionStorage.getItem(consecutiveSoundCloudReloadKey);
    if (!pendingTrackId) {
      return;
    }
    if (!trackId || pendingTrackId === trackId) {
      window.sessionStorage.removeItem(consecutiveSoundCloudReloadKey);
    }
  } catch {
  }
}
function reloadPageForConsecutiveSoundCloudHandoff(track) {
  setPendingConsecutiveSoundCloudReloadTrackId(track.id);
  sendClientLog("warn", "Reloading page for consecutive SoundCloud handoff", {
    trackId: track.id,
    title: track.title
  });
  const reloadUrl = new URL(window.location.href);
  reloadUrl.searchParams.set("handoffReload", String(Date.now()));
  window.location.replace(reloadUrl.toString());
}
function getYouTubeStartupRecoveryAttempts(trackId) {
  if (!trackId) {
    return 0;
  }
  try {
    const rawValue = window.sessionStorage.getItem(youtubeStartupRecoveryStorageKey);
    if (!rawValue) {
      return 0;
    }
    const parsedValue = JSON.parse(rawValue);
    if (parsedValue?.trackId !== trackId) {
      return 0;
    }
    return Number.isInteger(parsedValue.attempts) && parsedValue.attempts > 0 ? parsedValue.attempts : 0;
  } catch {
    return 0;
  }
}
function setYouTubeStartupRecoveryAttempts(trackId, attempts) {
  if (!trackId) {
    return;
  }
  try {
    window.sessionStorage.setItem(
      youtubeStartupRecoveryStorageKey,
      JSON.stringify({
        trackId,
        attempts
      })
    );
  } catch {
  }
}
function clearYouTubeStartupRecoveryAttempts(trackId = "") {
  try {
    const rawValue = window.sessionStorage.getItem(youtubeStartupRecoveryStorageKey);
    if (!rawValue) {
      return;
    }
    const parsedValue = JSON.parse(rawValue);
    if (!trackId || parsedValue?.trackId === trackId) {
      window.sessionStorage.removeItem(youtubeStartupRecoveryStorageKey);
    }
  } catch {
  }
}
function resetYouTubeStartupRecoveryState(trackId = "") {
  if (youtubeStartupRecoveryTrackId === trackId) {
    return;
  }
  youtubeStartupRecoveryTrackId = trackId;
  youtubeStartupHardResetAttempts = 0;
}
function reloadPageForYouTubeStartupRecovery(track, details = {}) {
  const nextAttempts = getYouTubeStartupRecoveryAttempts(track.id) + 1;
  setYouTubeStartupRecoveryAttempts(track.id, nextAttempts);
  sendClientLog("warn", "Reloading page for stuck YouTube startup", {
    trackId: track.id,
    title: track.title,
    attempts: nextAttempts,
    ...details
  });
  const reloadUrl = new URL(window.location.href);
  reloadUrl.searchParams.set("youtubeRecoveryReload", String(Date.now()));
  window.location.replace(reloadUrl.toString());
}
function handleYouTubeStartupTimeout(track, videoId) {
  if (!track?.id || desiredPausedState || currentTrackId !== track.id || activeTrack?.provider !== "youtube" || activeTrack?.id !== track.id) {
    return;
  }
  let playerState = null;
  let currentTimeSeconds = 0;
  try {
    playerState = youtubePlayer?.getPlayerState?.() ?? null;
    currentTimeSeconds = Number(youtubePlayer?.getCurrentTime?.() ?? 0) || 0;
  } catch {
  }
  if (currentTimeSeconds > 0.5) {
    clearYouTubeStartupRecoveryAttempts(track.id);
    return;
  }
  stopYouTubeAutoplayRetry();
  stopPlaybackTimer();
  if (youtubeStartupRecoveryTrackId !== track.id) {
    resetYouTubeStartupRecoveryState(track.id);
  }
  if (youtubeStartupHardResetAttempts < 1) {
    youtubeStartupHardResetAttempts += 1;
    sendClientLog("warn", "YouTube startup stalled; rebuilding player", {
      trackId: track.id,
      title: track.title,
      currentTimeSeconds,
      playerState,
      videoId,
      hardResetAttempts: youtubeStartupHardResetAttempts
    });
    hardResetYouTubePlayer();
    loadYoutubeTrack(track);
    return;
  }
  if (getYouTubeStartupRecoveryAttempts(track.id) < 1) {
    reloadPageForYouTubeStartupRecovery(track, {
      currentTimeSeconds,
      playerState,
      videoId
    });
    return;
  }
  sendClientLog("error", "YouTube startup timed out after recovery attempts", {
    trackId: track.id,
    title: track.title,
    currentTimeSeconds,
    playerState,
    videoId
  });
  clearYouTubeStartupRecoveryAttempts(track.id);
  reportClientError("This YouTube track could not be started in the embedded player.");
  emitStatus("error", { reason: "youtube_startup_timeout" });
}
function startYouTubeStartupWatchdog(track, videoId) {
  stopYouTubeStartupWatchdog();
  if (!track?.id || desiredPausedState) {
    return;
  }
  resetYouTubeStartupRecoveryState(track.id);
  const startedAt = Date.now();
  youtubeStartupWatchdogTimer = window.setInterval(() => {
    if (currentTrackId !== track.id || activeTrack?.provider !== "youtube" || activeTrack?.id !== track.id) {
      stopYouTubeStartupWatchdog();
      return;
    }
    let currentTimeSeconds = 0;
    try {
      currentTimeSeconds = Number(youtubePlayer?.getCurrentTime?.() ?? 0) || 0;
    } catch {
    }
    if (currentTimeSeconds > 0.5) {
      clearYouTubeStartupRecoveryAttempts(track.id);
      stopYouTubeStartupWatchdog();
      return;
    }
    if (startupTimeoutMs <= 0 || Date.now() - startedAt < startupTimeoutMs) {
      return;
    }
    stopYouTubeStartupWatchdog();
    handleYouTubeStartupTimeout(track, videoId);
  }, 1e3);
}
function startYouTubePlaybackTimer() {
  stopPlaybackTimer();
  playbackTimer = window.setInterval(() => {
    if (!youtubePlayer?.getCurrentTime || !youtubePlayer?.getDuration) {
      return;
    }
    const currentTimeSeconds = youtubePlayer.getCurrentTime();
    updateTimeline(currentTimeSeconds, youtubePlayer.getDuration(), {
      allowPositionRegression: false
    });
    if (currentTrackId && currentTimeSeconds > 0.5) {
      clearYouTubeStartupRecoveryAttempts(currentTrackId);
      stopYouTubeStartupWatchdog();
    }
  }, 500);
}
function ensureYouTubePlayerReady() {
  if (!window.YT?.Player) {
    return false;
  }
  youtubeApiReady = true;
  if (!youtubePlayer) {
    sendClientLog("info", "Initializing YouTube player instance");
    createYouTubePlayer();
  }
  return true;
}
function createYouTubePlayer() {
  youtubePlayerReady = false;
  youtubePlayer = new window.YT.Player("youtube-player", {
    height: "360",
    width: "640",
    playerVars: {
      autoplay: 1,
      controls: 1,
      rel: 0
    },
    events: {
      onReady: () => {
        youtubePlayerReady = true;
        sendClientLog("info", "YouTube player ready");
        applyYouTubeVolume();
        if (pendingYoutubeTrack) {
          youtubePlayer.loadVideoById(pendingYoutubeTrack.videoId);
          forceYoutubePlayback(pendingYoutubeTrack.videoId);
          pendingYoutubeTrack = null;
        }
      },
      onStateChange: (event) => {
        sendClientLog("info", "YouTube state changed", {
          state: event.data,
          currentTrackId
        });
        if (activeTrack?.provider !== "youtube" || currentTrackId !== activeTrack?.id) {
          sendClientLog("info", "Ignoring stale YouTube state change", {
            state: event.data,
            currentTrackId,
            activeProvider: activeTrack?.provider ?? null,
            activeTrackId: activeTrack?.id ?? null
          });
          return;
        }
        if (event.data === window.YT.PlayerState.PLAYING) {
          stopYouTubeAutoplayRetry();
          startYouTubePlaybackTimer();
          updateTimeline(youtubePlayer.getCurrentTime(), youtubePlayer.getDuration(), {
            allowPositionRegression: false
          });
          emitStatus("playing");
        }
        if (event.data === window.YT.PlayerState.PAUSED || event.data === window.YT.PlayerState.BUFFERING) {
          stopPlaybackTimer();
          updateTimeline(youtubePlayer.getCurrentTime(), youtubePlayer.getDuration(), {
            allowPositionRegression: false
          });
        }
        if (event.data === window.YT.PlayerState.UNSTARTED || event.data === window.YT.PlayerState.CUED) {
          if (youtubeEndedTrackId && youtubeEndedTrackId === currentTrackId) {
            sendClientLog("info", "Ignoring YouTube recovery after track end", {
              currentTrackId,
              state: event.data
            });
            return;
          }
          const currentVideoId = extractYouTubeVideoId(activeTrack?.url ?? "");
          forceYoutubePlayback(currentVideoId);
        }
        if (event.data === window.YT.PlayerState.ENDED) {
          youtubeEndedTrackId = currentTrackId ?? "";
          stopYouTubeAutoplayRetry();
          stopYouTubeStartupWatchdog();
          stopPlaybackTimer();
          clearYouTubeStartupRecoveryAttempts(currentTrackId ?? "");
          emitStatus("ended");
        }
      },
      onError: (event) => {
        if (activeTrack?.provider !== "youtube" || currentTrackId !== activeTrack?.id) {
          sendClientLog("warn", "Ignoring stale YouTube error", {
            code: event.data,
            currentTrackId,
            activeProvider: activeTrack?.provider ?? null,
            activeTrackId: activeTrack?.id ?? null
          });
          return;
        }
        sendClientLog("error", "YouTube player error", {
          code: event.data,
          currentTrackId
        });
        stopYouTubeStartupWatchdog();
        clearYouTubeStartupRecoveryAttempts(currentTrackId ?? "");
        emitStatus("error", { reason: `youtube_${event.data}` });
      }
    }
  });
}
function forceYoutubePlayback(videoId, attempt = 0) {
  if (!youtubePlayer || !currentTrackId) {
    return;
  }
  try {
    const playerState = youtubePlayer.getPlayerState?.();
    const loadedVideoUrl = youtubePlayer.getVideoUrl?.() || "";
    const loadedVideoId = loadedVideoUrl ? extractYouTubeVideoId(loadedVideoUrl) : null;
    const requestedVideoLoaded = !videoId || !loadedVideoId || loadedVideoId === videoId;
    if (playerState === window.YT?.PlayerState?.PLAYING && requestedVideoLoaded) {
      stopYouTubeAutoplayRetry();
      return;
    }
    if (!requestedVideoLoaded) {
      sendClientLog("info", "Waiting for requested YouTube video to become active", {
        attempt,
        currentTrackId,
        requestedVideoId: videoId,
        loadedVideoId,
        playerState
      });
      scheduleYouTubeAutoplayRetry(videoId, attempt);
      return;
    }
    applyYouTubeVolume();
    youtubePlayer.playVideo?.();
    sendClientLog("info", "Forcing YouTube playback", {
      attempt,
      currentTrackId,
      playerState,
      loadedVideoId
    });
    scheduleYouTubeAutoplayRetry(videoId, attempt);
  } catch (error) {
    sendClientLog("error", "Failed forcing YouTube playback", {
      message: error?.message ?? String(error),
      attempt
    });
  }
}
function hardResetYouTubePlayer() {
  stopYouTubeAutoplayRetry();
  stopYouTubeStartupWatchdog();
  stopPlaybackTimer();
  pendingYoutubeTrack = null;
  youtubePlayerReady = false;
  if (youtubePlayer) {
    let youtubeIframe = null;
    try {
      youtubeIframe = youtubePlayer.getIframe?.() ?? null;
    } catch {
    }
    try {
      youtubePlayer.mute?.();
      youtubePlayer.pauseVideo?.();
      youtubePlayer.stopVideo?.();
      youtubePlayer.clearVideo?.();
    } catch {
    }
    if (youtubeIframe) {
      try {
        youtubeIframe.src = "about:blank";
      } catch {
      }
    }
    try {
      youtubePlayer.destroy?.();
    } catch {
    }
  }
  youtubePlayer = null;
  const oldContainer = document.getElementById("youtube-player");
  if (oldContainer?.parentNode) {
    const replacement = document.createElement("div");
    replacement.id = "youtube-player";
    replacement.className = oldContainer.className;
    oldContainer.parentNode.replaceChild(replacement, oldContainer);
  }
}
function hardResetSoundCloudPlayer() {
  stopSoundCloudAutoplayRetry();
  stopSoundCloudDurationProbe();
  stopSoundCloudLoadTimeout();
  stopSoundCloudRecovery();
  if (soundCloudWidget?.pause) {
    try {
      soundCloudWidget.pause();
    } catch {
    }
  }
  if (soundCloudWidget?.unbind && window.SC?.Widget?.Events) {
    try {
      soundCloudWidget.unbind(window.SC.Widget.Events.ERROR);
      soundCloudWidget.unbind(window.SC.Widget.Events.FINISH);
      soundCloudWidget.unbind(window.SC.Widget.Events.PLAY_PROGRESS);
      soundCloudWidget.unbind(window.SC.Widget.Events.READY);
    } catch {
    }
  }
  soundCloudWidget = null;
  const oldFrame = document.getElementById("soundcloud-player");
  if (oldFrame?.parentNode) {
    const replacement = document.createElement("iframe");
    replacement.id = "soundcloud-player";
    replacement.className = oldFrame.className;
    replacement.title = "SoundCloud player";
    replacement.allow = "autoplay";
    oldFrame.parentNode.replaceChild(replacement, oldFrame);
    soundCloudFrame = replacement;
  }
}
function getYouTubeThumbnail(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
function getProviderLabel(provider) {
  if (provider === "autodj") {
    return "AutoDJ";
  }
  if (provider === "youtube") {
    return "YouTube";
  }
  if (provider === "soundcloud") {
    return "SoundCloud";
  }
  if (provider === "suno") {
    return "Suno";
  }
  return provider || "Unknown";
}
function getProviderFallbackText(provider) {
  if (provider === "autodj") {
    return "AD";
  }
  if (provider === "youtube") {
    return "YT";
  }
  if (provider === "soundcloud") {
    return "SC";
  }
  if (provider === "suno") {
    return "SU";
  }
  return "SR";
}
function setArtwork(url, fallbackText = "SR") {
  const requestId = ++artworkRequestId;
  const showFallback = () => {
    artworkImage.removeAttribute?.("src");
    artworkImage.classList.remove("is-visible");
    artworkFallback.classList.remove("is-hidden");
    artworkFallback.textContent = fallbackText;
  };
  showFallback();
  if (url && url !== failedArtworkUrl) {
    artworkImage.onerror = () => {
      if (requestId !== artworkRequestId || artworkImage.getAttribute?.("src") !== url) return;
      failedArtworkUrl = url;
      showFallback();
    };
    artworkImage.onload = () => {
      if (requestId !== artworkRequestId || artworkImage.getAttribute?.("src") !== url) return;
      if (failedArtworkUrl === url) {
        failedArtworkUrl = "";
      }
      artworkImage.classList.add("is-visible");
      artworkFallback.classList.add("is-hidden");
    };
    if (typeof artworkImage.setAttribute === "function") {
      artworkImage.setAttribute("src", url);
    } else {
      artworkImage.src = url;
    }
  }
}
function setNextArtwork(url, fallbackText = "B") {
  if (!nextArtworkImage || !nextArtworkFallback) {
    return;
  }
  const requestId = ++nextArtworkRequestId;
  const showFallback = () => {
    nextArtworkImage.removeAttribute?.("src");
    nextArtworkImage.classList.remove("is-visible");
    nextArtworkFallback.classList.remove("is-hidden");
    nextArtworkFallback.textContent = fallbackText;
  };
  showFallback();
  if (!url || url === failedNextArtworkUrl) {
    return;
  }
  nextArtworkImage.onerror = () => {
    if (requestId !== nextArtworkRequestId || nextArtworkImage.getAttribute?.("src") !== url) return;
    failedNextArtworkUrl = url;
    showFallback();
  };
  nextArtworkImage.onload = () => {
    if (requestId !== nextArtworkRequestId || nextArtworkImage.getAttribute?.("src") !== url) return;
    if (failedNextArtworkUrl === url) {
      failedNextArtworkUrl = "";
    }
    nextArtworkImage.classList.add("is-visible");
    nextArtworkFallback.classList.add("is-hidden");
  };
  if (typeof nextArtworkImage.setAttribute === "function") {
    nextArtworkImage.setAttribute("src", url);
  } else {
    nextArtworkImage.src = url;
  }
}
function resolveArtwork(track) {
  if (!track) {
    return "";
  }
  if (track.artworkUrl) {
    return track.artworkUrl;
  }
  if (track.provider === "youtube") {
    const videoId = extractYouTubeVideoId(track.url);
    return videoId ? getYouTubeThumbnail(videoId) : "";
  }
  return "";
}
function setMetaText(message) {
  if (currentMeta) {
    currentMeta.textContent = message;
  }
}
function getOverlayThemeId() {
  return document.documentElement.dataset.theme || "aurora";
}
function splitArtistAndTitle(title) {
  if (typeof title !== "string") {
    return null;
  }
  const trimmedTitle = title.trim();
  const separatorMatch = trimmedTitle.match(/\s[-–—]\s/);
  if (!separatorMatch?.index) {
    return null;
  }
  const separatorIndex = separatorMatch.index;
  const artist = trimmedTitle.slice(0, separatorIndex).trim();
  const trackTitle = trimmedTitle.slice(separatorIndex + separatorMatch[0].length).trim();
  if (!artist || !trackTitle || artist.length > 48) {
    return null;
  }
  return {
    artist,
    trackTitle
  };
}
function describeTrackMeta(track) {
  if (!track) {
    return socketConnected ? "Queue is empty. Fallback playlist will play automatically." : "Connecting to the player service...";
  }
  if (track.overlaySource === "autodj") {
    return track.artist ? `${track.artist} \u2022 Standalone AutoDJ` : "Playing from standalone AutoDJ";
  }
  if (isExternalPlaybackTrack(track)) {
    return "Playing in OBS YouTube fallback";
  }
  if (track.origin === "radio") {
    return `Auto radio from ${getProviderLabel(track.provider)}`;
  }
  if (track.origin === "playlist") {
    return `Playlist fallback from ${getProviderLabel(track.provider)}`;
  }
  const requester = track.requestedBy?.displayName || track.requestedBy?.username || "unknown";
  return `Requested by ${requester}`;
}
function getDisplayedTrackText(track) {
  if (!track) {
    return {
      title: "Waiting for a track",
      meta: describeTrackMeta(track)
    };
  }
  if (getOverlayThemeId() !== "slate") {
    return {
      title: track.title,
      meta: describeTrackMeta(track)
    };
  }
  const separatedTrack = splitArtistAndTitle(track.title);
  if (separatedTrack) {
    return {
      title: separatedTrack.trackTitle,
      meta: separatedTrack.artist
    };
  }
  if (track.origin === "playlist" || track.origin === "radio") {
    return {
      title: track.title,
      meta: track.origin === "radio" ? `Radio \u2022 ${getProviderLabel(track.provider)}` : getProviderLabel(track.provider)
    };
  }
  const requester = track.requestedBy?.displayName || track.requestedBy?.username || "";
  return {
    title: track.title,
    meta: requester ? `Requested by ${requester}` : getProviderLabel(track.provider)
  };
}
function getOverlayQueueTrackIdentity(track) {
  if (!track || typeof track !== "object") {
    return "";
  }
  const key = typeof track.key === "string" ? track.key.trim().toLowerCase() : "";
  if (key) {
    return `key:${key}`;
  }
  const id = typeof track.id === "string" ? track.id.trim() : "";
  if (id) {
    return `id:${id}`;
  }
  const provider = typeof track.provider === "string" ? track.provider.trim().toLowerCase() : "";
  const url = typeof track.url === "string" ? track.url.trim() : "";
  if (url) {
    return `url:${provider}:${url}`;
  }
  const title = typeof track.title === "string" ? track.title.trim().toLowerCase() : "";
  return title ? `title:${provider}:${title}` : "";
}
function toAutoDjOverlayTrack(track, playback = {}) {
  if (!track || typeof track !== "object") {
    return null;
  }
  const id = typeof track.id === "string" && track.id ? track.id : track.key || track.title || "current";
  return {
    ...track,
    id: `autodj:${id}`,
    provider: "autodj",
    origin: "local",
    overlaySource: "autodj",
    elapsedSeconds: Number.isFinite(playback.currentTimeSeconds) ? Math.max(0, playback.currentTimeSeconds) : 0,
    durationSeconds: Number.isFinite(playback.durationSeconds) && playback.durationSeconds > 0 ? playback.durationSeconds : track.durationSeconds,
    playbackRate: Number.isFinite(playback.playbackRate) && playback.playbackRate > 0 ? playback.playbackRate : 1,
    isPaused: playback.status === "paused"
  };
}
function buildOverlayPresentationState(state) {
  if (state?.currentTrack) {
    return state;
  }
  const controller = state?.autoDjController;
  if (!controller?.connection?.responding || controller?.activation?.effective !== true || controller?.takeover?.active === true || !controller?.currentTrack) {
    return state;
  }
  const playback = controller.playback ?? {};
  return {
    ...state,
    currentTrack: toAutoDjOverlayTrack(controller.currentTrack, playback),
    queue: Array.isArray(controller.upcomingTracks) ? controller.upcomingTracks.map((track) => toAutoDjOverlayTrack(track, {})).filter(Boolean) : [],
    playbackStatus: playback.status || "playing",
    autoDjPresentation: true
  };
}
function buildOverlayUpNextQueue(state = latestPlayerState) {
  const normalQueue = Array.isArray(state?.queue) ? state.queue : [];
  const stateCurrentTrack = state?.currentTrack ?? null;
  const candidates = normalQueue;
  const currentIdentities = new Set(
    [stateCurrentTrack, activeTrack].map(getOverlayQueueTrackIdentity).filter(Boolean)
  );
  const seen = /* @__PURE__ */ new Set();
  return candidates.filter((track) => {
    const identity = getOverlayQueueTrackIdentity(track);
    if (identity && currentIdentities.has(identity) || identity && seen.has(identity)) {
      return false;
    }
    if (track?.id && (track.id === stateCurrentTrack?.id || track.id === currentTrackId)) {
      return false;
    }
    if (identity) {
      seen.add(identity);
    }
    return Boolean(track);
  });
}
function getOverlayQueueMeta(track) {
  if (track?.origin === "radio") {
    return "radio";
  }
  const requester = track?.requestedBy?.displayName || track?.requestedBy?.username || "";
  if (requester) {
    return requester;
  }
  return "playlist";
}
function renderNextDeck(track) {
  if (!nextDeck || !nextTitle || !nextMeta || !nextProviderBadge) {
    return;
  }
  nextDeck.classList.toggle?.("is-empty", !track);
  nextTitle.textContent = track?.title || "Queue clear";
  nextMeta.textContent = track ? describeTrackMeta(track) : "Waiting for the next request";
  nextProviderBadge.textContent = track ? getProviderLabel(track.provider) : "Standby";
  setNextArtwork(
    resolveArtwork(track),
    track ? getProviderFallbackText(track.provider) : "B"
  );
}
function refreshOverlayQueue(state = latestPlayerState) {
  const queue = buildOverlayUpNextQueue(state);
  queueCount.textContent = `${queue.length} queued`;
  renderNextDeck(queue[0] ?? null);
  renderQueue(queue.slice(1));
  return queue;
}
function applyStateToUi(state) {
  const currentTrack = state.currentTrack;
  const isAutoDjTrack = currentTrack?.overlaySource === "autodj";
  const wasAutoDjTrack = displayedAutoDjTrack;
  const displayText = getDisplayedTrackText(currentTrack);
  const titleText = displayText.title;
  const titleChanged = (currentTitleText?.textContent ?? "") !== titleText || (currentTitleTextClone?.textContent ?? "") !== titleText;
  if (currentTitleText) {
    currentTitleText.textContent = titleText;
  }
  if (currentTitleTextClone) {
    currentTitleTextClone.textContent = titleText;
  }
  if (titleChanged) {
    scheduleTitleMarqueeUpdate();
    scheduleDelayedTitleMarqueeUpdate(320);
  }
  setMetaText(displayText.meta);
  providerBadge.textContent = currentTrack ? getProviderLabel(currentTrack.provider) : "Idle";
  saveBadge.textContent = isAutoDjTrack ? "Live" : currentTrack ? currentTrack.isSaved ? "Saved" : "Unsaved" : "Unsaved";
  saveBadge.className = isAutoDjTrack || currentTrack?.isSaved ? "save-badge save-badge--saved" : "save-badge save-badge--idle";
  setArtwork(
    resolveArtwork(currentTrack),
    currentTrack ? getProviderFallbackText(currentTrack.provider) : "SR"
  );
  refreshOverlayQueue(state);
  if (isAutoDjTrack) {
    const trackChanged = displayedTrackId !== currentTrack.id;
    syncServerTimelineFromTrackState(currentTrack);
    updateTimeline(currentTrack.elapsedSeconds, currentTrack.durationSeconds, {
      allowPositionRegression: trackChanged
    });
  } else if (wasAutoDjTrack && !currentTrack) {
    resetTimeline();
  }
  displayedTrackId = currentTrack?.id ?? null;
  displayedAutoDjTrack = isAutoDjTrack;
}
function stopTrackTransitionTimers() {
  if (trackExitTimer) {
    window.clearTimeout(trackExitTimer);
    trackExitTimer = null;
  }
  if (trackEnterTimer) {
    window.clearTimeout(trackEnterTimer);
    trackEnterTimer = null;
  }
}
function animateUiToState(state) {
  stopTrackTransitionTimers();
  playerCard.classList.remove("is-track-exiting", "is-track-entering");
  void playerCard.offsetWidth;
  playerCard.classList.add("is-track-exiting");
  trackExitTimer = window.setTimeout(() => {
    applyStateToUi(state);
    playerCard.classList.remove("is-track-exiting");
    void playerCard.offsetWidth;
    playerCard.classList.add("is-track-entering");
    trackEnterTimer = window.setTimeout(() => {
      playerCard.classList.remove("is-track-entering");
      trackEnterTimer = null;
    }, 820);
    trackExitTimer = null;
  }, 340);
}
function notifyUnifiedOverlayParent(state) {
  try {
    if (!window.location?.search?.includes("unifiedOverlay=1") || !window.parent || window.parent === window) {
      return;
    }
    const currentTrack = state?.currentTrack;
    window.parent.postMessage({
      type: "tsrp:overlay-state",
      activeEngine: "center",
      currentTrack: currentTrack ? {
        id: currentTrack.id ?? "",
        provider: currentTrack.provider ?? "",
        origin: currentTrack.origin ?? ""
      } : null,
      playbackStatus: state?.playbackStatus ?? ""
    }, "*");
  } catch (_error) {
  }
}
function updateState(state) {
  if (typeof state.overlayBuildToken === "string" && state.overlayBuildToken && overlayBuildToken && state.overlayBuildToken !== overlayBuildToken) {
    sendClientLog("warn", "Overlay build token changed, reloading browser source", {
      clientOverlayBuildToken: overlayBuildToken,
      serverOverlayBuildToken: state.overlayBuildToken
    });
    window.location.reload();
    return;
  }
  latestPlayerState = state;
  const currentTrack = state.currentTrack;
  const presentationState = buildOverlayPresentationState(state);
  const presentedTrack = presentationState.currentTrack;
  const queue = buildOverlayUpNextQueue(presentationState);
  notifyUnifiedOverlayParent(state);
  desiredPausedState = Boolean(currentTrack?.isPaused);
  const stateSignature = JSON.stringify({
    currentTrackId: presentedTrack?.id ?? null,
    playbackMode: presentedTrack?.playbackMode ?? "",
    queueLength: queue.length,
    isPaused: Boolean(currentTrack?.isPaused)
  });
  if (stateSignature !== lastLoggedStateSignature) {
    lastLoggedStateSignature = stateSignature;
    sendClientLog("info", "State received", {
      currentTrack: presentedTrack ? {
        id: presentedTrack.id,
        title: presentedTrack.title,
        provider: presentedTrack.provider,
        origin: presentedTrack.origin,
        isSaved: presentedTrack.isSaved
      } : null,
      queueLength: queue.length
    });
  }
  const overlayScaleChanged = Object.prototype.hasOwnProperty.call(state, "overlayScalePercent") ? applyOverlayScale(state.overlayScalePercent) : false;
  if (typeof state.theme === "string" && state.theme) {
    const previousTheme = document.documentElement.dataset.theme;
    applyOverlayTheme(state.theme);
    if (state.theme !== previousTheme || overlayScaleChanged) {
      scheduleTitleMarqueeUpdate();
      requestAnimationFrame(() => reportOverlaySize());
    }
  } else if (overlayScaleChanged) {
    scheduleTitleMarqueeUpdate();
    requestAnimationFrame(() => reportOverlaySize());
  }
  if (Object.prototype.hasOwnProperty.call(state, "playerStartupTimeoutSeconds")) {
    applyStartupTimeoutSetting(state.playerStartupTimeoutSeconds);
  }
  if (displayedTrackId !== null && presentedTrack?.id !== displayedTrackId) {
    animateUiToState(presentationState);
  } else {
    stopTrackTransitionTimers();
    playerCard.classList.remove("is-track-exiting", "is-track-entering");
    applyStateToUi(presentationState);
  }
  if (currentTrack) {
    if (isExternalPlaybackTrack(currentTrack)) {
      displayExternalPlaybackTrack(currentTrack);
      return;
    }
    const wasSameActiveTrack = currentTrack.id === currentTrackId;
    loadTrack(currentTrack);
    syncTimelineFromTrackState(currentTrack, {
      resetMissingTiming: !wasSameActiveTrack
    });
    syncPausedState();
  } else if (currentTrackId) {
    clearYouTubeStartupRecoveryAttempts(currentTrackId);
    rememberTrackForHandoff();
    activeTrack = null;
    currentTrackId = null;
    lastReportedStatus = "";
    desiredPausedState = false;
    resetPlayers();
    resetTimeline();
  }
}
function renderQueue(queue) {
  const visibleQueue = queue.slice(0, 3);
  const queueSignature = JSON.stringify(
    visibleQueue.map((track) => ({
      identity: getOverlayQueueTrackIdentity(track),
      title: track.title,
      requester: getOverlayQueueMeta(track),
      isSaved: Boolean(track.isSaved)
    }))
  );
  if (queueSignature === lastRenderedQueueSignature) {
    return;
  }
  lastRenderedQueueSignature = queueSignature;
  queueList.innerHTML = "";
  visibleQueue.forEach((track, index) => {
    const item = document.createElement("li");
    item.className = "queue-item";
    item.style.animationDelay = `${index * 70}ms`;
    const requester = getOverlayQueueMeta(track);
    const title = document.createElement("span");
    title.className = "queue-title";
    title.textContent = track.title;
    const meta = document.createElement("span");
    meta.className = "queue-meta";
    meta.textContent = requester;
    item.appendChild(title);
    item.appendChild(meta);
    queueList.appendChild(item);
  });
}
function startStatePolling() {
  if (statePollTimer) {
    return;
  }
  statePollTimer = window.setInterval(() => {
    void fetchState().catch(() => {
    });
  }, 3e3);
}
async function fetchState() {
  const response = await fetch("/api/state", {
    cache: "no-store",
    headers: {
      "X-Playback-Client": playbackClientRole
    }
  });
  if (!response.ok) {
    throw new Error(`State request failed: ${response.status}`);
  }
  const state = await response.json();
  updateState(state);
}
function reportClientError(message) {
  sendClientLog("error", message, {
    currentTrackId
  });
  setMetaText(message);
}
function rememberTrackForHandoff(track = activeTrack) {
  if (!track?.provider) {
    return;
  }
  handoffSourceTrack = {
    id: track.id ?? null,
    provider: track.provider
  };
}
function handleSocketDisconnect() {
  socketConnected = false;
  sendClientLog("warn", "Socket disconnected");
  startStatePolling();
  if (!currentTrackId) {
    setMetaText("Connection lost. Retrying player service...");
  }
}
function handleSocketConnect() {
  socketConnected = true;
  sendClientLog("info", "Socket connected");
}
function postPlayerEvent(eventPayload) {
  return fetch("/api/player-event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(eventPayload)
  });
}
function getReportedDurationSeconds(value = currentDurationSeconds) {
  const durationSeconds = Number(value);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }
  return Math.floor(durationSeconds);
}
function emitStatus(status, extra = {}) {
  emitTrackStatus(currentTrackId, status, extra);
}
function emitTrackStatus(trackId, status, extra = {}) {
  if (!trackId) {
    return;
  }
  const eventPayload = {
    trackId,
    status,
    ...extra
  };
  if (status === "playing") {
    const reportedDurationSeconds = getReportedDurationSeconds(eventPayload.durationSeconds);
    if (reportedDurationSeconds !== null) {
      eventPayload.durationSeconds = reportedDurationSeconds;
    } else {
      delete eventPayload.durationSeconds;
    }
  }
  const dedupeKey = status === "playing" && Number.isFinite(eventPayload.durationSeconds) ? `${trackId}:${status}:${eventPayload.durationSeconds}` : `${trackId}:${status}`;
  if (lastReportedStatus === dedupeKey) {
    return;
  }
  lastReportedStatus = dedupeKey;
  if (socketConnected) {
    sendClientLog("info", "Sending player event over socket", eventPayload);
    socket.emit("player:event", eventPayload);
    return;
  }
  sendClientLog("warn", "Sending player event over HTTP fallback", eventPayload);
  postPlayerEvent(eventPayload).catch(() => {
  });
}
function isActiveProviderTrack(track, provider) {
  return Boolean(
    track?.id && currentTrackId === track.id && activeTrack?.id === track.id && activeTrack?.provider === provider
  );
}
function resetPlayers() {
  youtubeEndedTrackId = "";
  pendingYoutubeTrack = null;
  stopPlaybackTimer();
  stopYouTubeAutoplayRetry();
  stopYouTubeStartupWatchdog();
  stopSoundCloudAutoplayRetry();
  stopSoundCloudDurationProbe();
  stopSoundCloudLoadTimeout();
  soundCloudFrame.style.display = "none";
  soundCloudFrame.removeAttribute("src");
  if (youtubePlayer) {
    try {
      youtubePlayer.pauseVideo?.();
      youtubePlayer.stopVideo?.();
    } catch {
    }
  }
  if (soundCloudWidget?.pause) {
    try {
      soundCloudWidget.pause();
    } catch {
    }
  }
  if (soundCloudWidget?.unbind && window.SC?.Widget?.Events) {
    soundCloudWidget.unbind(window.SC.Widget.Events.ERROR);
    soundCloudWidget.unbind(window.SC.Widget.Events.FINISH);
    soundCloudWidget.unbind(window.SC.Widget.Events.PLAY_PROGRESS);
    soundCloudWidget.unbind(window.SC.Widget.Events.READY);
  }
  soundCloudWidget = null;
  if (isSunoAudioPlayer(sunoAudio)) {
    sunoAudio.onloadedmetadata = null;
    sunoAudio.oncanplay = null;
    sunoAudio.onplay = null;
    sunoAudio.onplaying = null;
    sunoAudio.ontimeupdate = null;
    sunoAudio.onpause = null;
    sunoAudio.onended = null;
    sunoAudio.onerror = null;
    try {
      sunoAudio.pause();
      sunoAudio.removeAttribute("src");
      sunoAudio.load();
    } catch {
    }
  }
}
function extractYouTubeVideoId(url) {
  const parsed = new URL(url);
  if (parsed.hostname === "youtu.be") {
    return parsed.pathname.slice(1);
  }
  if (parsed.searchParams.has("v")) {
    return parsed.searchParams.get("v");
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => part === "embed" || part === "shorts");
  return index >= 0 ? parts[index + 1] : null;
}
function parseSoundCloudWidgetResourceUrl(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) {
    return null;
  }
  try {
    const parsedUrl = new URL(candidate);
    const hostname = parsedUrl.hostname.toLowerCase();
    const isSoundCloudHost = hostname === "soundcloud.com" || hostname === "www.soundcloud.com" || hostname === "m.soundcloud.com" || hostname === "api.soundcloud.com";
    if (parsedUrl.protocol !== "https:" || !isSoundCloudHost) {
      return null;
    }
    const secretToken = parsedUrl.searchParams.get("secret_token")?.trim() ?? "";
    const secretSharePath = /(?:^|\/)s-[a-z0-9_-]+(?:\/|$)/i.test(parsedUrl.pathname);
    return {
      url: parsedUrl.toString(),
      privateResource: Boolean(secretToken || secretSharePath)
    };
  } catch {
    return null;
  }
}
function getSoundCloudWidgetResource(track) {
  const canonicalResourceUrl = typeof track?.soundCloudResourceUrl === "string" ? track.soundCloudResourceUrl.trim() : "";
  const canonical = parseSoundCloudWidgetResourceUrl(canonicalResourceUrl);
  const canonicalApi = canonical && new URL(canonical.url).hostname.toLowerCase() === "api.soundcloud.com" && /^\/(?:tracks|playlists)\/\d+\/?$/.test(new URL(canonical.url).pathname) ? canonical : null;
  const original = parseSoundCloudWidgetResourceUrl(track?.url);
  if (canonicalApi?.privateResource) {
    return { ...canonicalApi, kind: "private-api-resource" };
  }
  if (original?.privateResource) {
    return { ...original, kind: "private-share-url" };
  }
  if (canonicalApi) {
    return { ...canonicalApi, kind: "canonical-api-resource" };
  }
  return {
    url: original?.url ?? String(track?.url ?? ""),
    privateResource: false,
    kind: "track-url"
  };
}
function getSoundCloudWidgetResourceUrl(track) {
  return getSoundCloudWidgetResource(track).url;
}
function soundCloudWidgetErrorTelemetry(event) {
  const record = event && typeof event === "object" ? event : {};
  const boundedText = (value, maximum = 240) => {
    const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    return text.slice(0, maximum);
  };
  const providerErrorCode = boundedText(record.code ?? record.errorCode ?? event, 80);
  const providerErrorMessage = boundedText(record.message ?? record.error ?? record.reason);
  const providerHttpStatus = Number(record.status ?? record.statusCode);
  return {
    ...providerErrorCode ? { providerErrorCode } : {},
    ...providerErrorMessage ? { providerErrorMessage } : {},
    ...Number.isInteger(providerHttpStatus) && providerHttpStatus >= 100 && providerHttpStatus <= 599 ? { providerHttpStatus } : {}
  };
}
function scheduleSoundCloudWidgetRecovery(track, recoveryAttempt, event) {
  if (recoveryAttempt >= maxSoundCloudRecoveryAttempts) {
    return false;
  }
  stopSoundCloudLoadTimeout();
  stopSoundCloudAutoplayRetry();
  stopSoundCloudDurationProbe();
  stopSoundCloudRecovery();
  const resource = getSoundCloudWidgetResource(track);
  sendClientLog("warn", "SoundCloud widget error; retrying track", {
    id: track.id,
    title: track.title,
    ...soundCloudWidgetErrorTelemetry(event),
    resourceKind: resource.kind,
    privateResource: resource.privateResource,
    recoveryAttempt: recoveryAttempt + 1
  });
  soundCloudRecoveryTimer = window.setTimeout(() => {
    soundCloudRecoveryTimer = null;
    if (!isActiveProviderTrack(track, "soundcloud")) {
      return;
    }
    loadSoundCloudTrack(track, {
      recoveryAttempt: recoveryAttempt + 1
    });
  }, soundCloudRecoveryDelayMs);
  return true;
}
function loadSoundCloudTrack(track, { recoveryAttempt = 0 } = {}) {
  if (!window.SC?.Widget) {
    reportClientError("SoundCloud player API did not load in OBS.");
    return;
  }
  hardResetSoundCloudPlayer();
  const soundCloudResource = getSoundCloudWidgetResource(track);
  sendClientLog("info", "Loading SoundCloud track", {
    id: track.id,
    title: track.title,
    resourceKind: soundCloudResource.kind,
    privateResource: soundCloudResource.privateResource,
    recoveryAttempt
  });
  const soundCloudResourceUrl = soundCloudResource.url;
  soundCloudFrame.style.display = "block";
  soundCloudFrame.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(soundCloudResourceUrl)}&auto_play=true&hide_related=true&show_artwork=false&visual=false`;
  soundCloudWidget = window.SC.Widget(soundCloudFrame);
  scheduleSoundCloudLoadTimeout(track);
  let widgetErrorHandled = false;
  const updateDurationFromSoundCloud = () => {
    if (!soundCloudWidget) {
      return;
    }
    soundCloudWidget.getDuration((durationMs) => {
      if (Number.isFinite(durationMs) && durationMs > 0) {
        updateTimeline(currentPositionSeconds, durationMs / 1e3);
        stopSoundCloudDurationProbe();
      }
    });
  };
  soundCloudWidget.bind(window.SC.Widget.Events.READY, () => {
    if (!isActiveProviderTrack(track, "soundcloud")) {
      sendClientLog("warn", "Ignoring stale SoundCloud ready event", {
        id: track.id,
        title: track.title
      });
      return;
    }
    applySoundCloudVolume();
    updateDurationFromSoundCloud();
    stopSoundCloudDurationProbe();
    soundCloudDurationProbeTimer = window.setInterval(updateDurationFromSoundCloud, 1500);
    soundCloudWidget.getCurrentSound((sound) => {
      const artworkUrl = sound?.artwork_url || sound?.user?.avatar_url || "";
      const durationMs = sound?.duration;
      if (artworkUrl) {
        setArtwork(artworkUrl.replace("-large", "-t500x500"), "SC");
      }
      if (Number.isFinite(durationMs) && durationMs > 0) {
        updateTimeline(currentPositionSeconds, durationMs / 1e3);
        stopSoundCloudDurationProbe();
      }
    });
    sendClientLog("info", "SoundCloud widget ready", {
      id: track.id,
      title: track.title
    });
    if (desiredPausedState) {
      stopSoundCloudLoadTimeout();
      stopSoundCloudAutoplayRetry();
      soundCloudWidget.pause();
      return;
    }
    forceSoundCloudPlayback(track.id);
  });
  soundCloudWidget.bind(window.SC.Widget.Events.ERROR, (event) => {
    if (widgetErrorHandled) {
      return;
    }
    widgetErrorHandled = true;
    if (!isActiveProviderTrack(track, "soundcloud")) {
      sendClientLog("warn", "Ignoring stale SoundCloud error event", {
        id: track.id,
        title: track.title,
        event
      });
      return;
    }
    if (scheduleSoundCloudWidgetRecovery(track, recoveryAttempt, event)) {
      return;
    }
    stopSoundCloudLoadTimeout();
    stopSoundCloudAutoplayRetry();
    stopSoundCloudDurationProbe();
    const resource = getSoundCloudWidgetResource(track);
    const errorTelemetry = soundCloudWidgetErrorTelemetry(event);
    sendClientLog("error", "SoundCloud widget error", {
      id: track.id,
      title: track.title,
      ...errorTelemetry,
      resourceKind: resource.kind,
      privateResource: resource.privateResource,
      recoveryAttempts: recoveryAttempt
    });
    hardResetSoundCloudPlayer();
    reportClientError("This SoundCloud track could not be played in the embedded player.");
    emitStatus("error", {
      reason: "soundcloud_widget_error",
      ...errorTelemetry,
      resourceKind: resource.kind,
      privateResource: resource.privateResource,
      recoveryAttempts: recoveryAttempt
    });
  });
  soundCloudWidget.bind(window.SC.Widget.Events.FINISH, () => {
    if (!isActiveProviderTrack(track, "soundcloud")) {
      sendClientLog("warn", "Ignoring stale SoundCloud finish event", {
        id: track.id,
        title: track.title
      });
      return;
    }
    stopSoundCloudLoadTimeout();
    stopSoundCloudAutoplayRetry();
    stopSoundCloudDurationProbe();
    sendClientLog("info", "SoundCloud track finished", {
      id: track.id,
      title: track.title
    });
    emitStatus("ended");
  });
  soundCloudWidget.bind(window.SC.Widget.Events.PLAY_PROGRESS, (event) => {
    if (!isActiveProviderTrack(track, "soundcloud")) {
      return;
    }
    const currentSeconds = Number.isFinite(event.currentPosition) ? event.currentPosition / 1e3 : currentPositionSeconds;
    const durationSeconds = Number.isFinite(event.duration) && event.duration > 0 ? event.duration / 1e3 : currentDurationSeconds;
    updateTimeline(currentSeconds, durationSeconds);
    if (currentSeconds > 0) {
      widgetErrorHandled = false;
      stopSoundCloudLoadTimeout();
      stopSoundCloudAutoplayRetry();
      stopSoundCloudRecovery();
      emitStatus("playing");
    }
  });
}
function forceSoundCloudPlayback(trackId, attempt = 0) {
  if (!soundCloudWidget || !currentTrackId || activeTrack?.provider !== "soundcloud" || currentTrackId !== trackId) {
    stopSoundCloudAutoplayRetry();
    return;
  }
  if (desiredPausedState) {
    stopSoundCloudAutoplayRetry();
    return;
  }
  try {
    soundCloudWidget.play();
    sendClientLog("info", "Forcing SoundCloud playback", {
      attempt,
      trackId
    });
    scheduleSoundCloudAutoplayRetry(trackId, attempt);
  } catch (error) {
    sendClientLog("error", "Failed forcing SoundCloud playback", {
      message: error?.message ?? String(error),
      attempt,
      trackId
    });
  }
}
function loadSunoTrack(track) {
  if (!isSunoAudioPlayer(sunoAudio)) {
    reportClientError("Suno audio playback is not available in this browser source.");
    emitStatus("error", { reason: "suno_audio_unavailable" });
    return;
  }
  const audioUrl = typeof track.audioUrl === "string" ? track.audioUrl.trim() : "";
  if (!audioUrl) {
    reportClientError("This Suno track is missing a playable audio stream.");
    emitStatus("error", { reason: "suno_missing_audio_url" });
    return;
  }
  sendClientLog("info", "Loading Suno track", {
    id: track.id,
    title: track.title,
    url: track.url,
    audioUrl
  });
  resetPlayers();
  activeTrack = track;
  currentTrackId = track.id;
  applySunoVolume();
  sunoAudio.src = audioUrl;
  sunoAudio.preload = "metadata";
  sunoAudio.onloadedmetadata = () => {
    const durationSeconds = Number.isFinite(sunoAudio.duration) && sunoAudio.duration > 0 ? sunoAudio.duration : Number.isFinite(track.durationSeconds) ? track.durationSeconds : 0;
    updateTimeline(0, durationSeconds);
  };
  sunoAudio.oncanplay = () => {
    if (desiredPausedState) {
      try {
        sunoAudio.pause();
      } catch {
      }
      return;
    }
    const playPromise = sunoAudio.play();
    if (playPromise?.catch) {
      playPromise.catch((error) => {
        sendClientLog("error", "Failed starting Suno playback", {
          id: track.id,
          title: track.title,
          message: error?.message ?? String(error)
        });
        reportClientError("This Suno track could not be started in the embedded player.");
        emitStatus("error", { reason: "suno_audio_error" });
      });
    }
  };
  sunoAudio.onplaying = () => {
    emitStatus("playing");
  };
  sunoAudio.ontimeupdate = () => {
    const durationSeconds = Number.isFinite(sunoAudio.duration) && sunoAudio.duration > 0 ? sunoAudio.duration : Number.isFinite(track.durationSeconds) ? track.durationSeconds : currentDurationSeconds;
    updateTimeline(sunoAudio.currentTime, durationSeconds);
    if (sunoAudio.currentTime > 0) {
      emitStatus("playing");
    }
  };
  sunoAudio.onended = () => {
    sendClientLog("info", "Suno track finished", {
      id: track.id,
      title: track.title
    });
    emitStatus("ended");
  };
  sunoAudio.onerror = () => {
    sendClientLog("error", "Suno audio element error", {
      id: track.id,
      title: track.title,
      audioUrl
    });
    reportClientError("This Suno track could not be played in the embedded player.");
    emitStatus("error", { reason: "suno_audio_error" });
  };
  try {
    sunoAudio.load();
  } catch (error) {
    sendClientLog("error", "Failed loading Suno audio element", {
      id: track.id,
      title: track.title,
      message: error?.message ?? String(error)
    });
    reportClientError("This Suno track could not be loaded in the embedded player.");
    emitStatus("error", { reason: "suno_audio_error" });
  }
}
function loadYoutubeTrack(track) {
  const videoId = extractYouTubeVideoId(track.url);
  if (!videoId) {
    emitStatus("error", { reason: "invalid_youtube_url" });
    return;
  }
  sendClientLog("info", "Loading YouTube track", {
    id: track.id,
    title: track.title,
    videoId,
    url: track.url
  });
  if (!desiredPausedState) {
    startYouTubeStartupWatchdog(track, videoId);
  }
  if (!youtubePlayer || !youtubePlayerReady) {
    pendingYoutubeTrack = { track, videoId };
    if (!ensureYouTubePlayerReady()) {
      reportClientError("Waiting for YouTube player API...");
      return;
    }
    sendClientLog("info", "Waiting for YouTube player readiness", {
      id: track.id,
      title: track.title,
      videoId
    });
    return;
  }
  youtubePlayer.loadVideoById(videoId);
  if (desiredPausedState) {
    stopYouTubeStartupWatchdog();
    window.setTimeout(() => {
      if (currentTrackId === track.id) {
        youtubePlayer.pauseVideo?.();
      }
    }, 250);
    return;
  }
  forceYoutubePlayback(videoId);
}
function displayExternalPlaybackTrack(track) {
  if (!track) {
    return;
  }
  const isNewExternalTrack = track.id !== currentTrackId || !isExternalPlaybackTrack(activeTrack);
  if (isNewExternalTrack) {
    sendClientLog("info", "Displaying external playback track", {
      id: track.id,
      title: track.title,
      playbackProvider: track.playbackProvider ?? ""
    });
    resetPlayers();
    resetTimeline();
    activeTrack = track;
    currentTrackId = track.id;
    lastReportedStatus = `external:${track.id}`;
  } else {
    activeTrack = {
      ...activeTrack,
      ...track
    };
  }
  startExternalPlaybackTimer(activeTrack, { resetMissingTiming: isNewExternalTrack });
}
function syncPausedState() {
  if (!currentTrackId || !activeTrack) {
    return;
  }
  if (isExternalPlaybackTrack(activeTrack)) {
    return;
  }
  if (activeTrack.provider === "youtube" && youtubePlayer) {
    if (desiredPausedState) {
      stopYouTubeStartupWatchdog();
      youtubePlayer.pauseVideo?.();
      stopPlaybackTimer();
    } else {
      const videoId = extractYouTubeVideoId(activeTrack.url);
      startYouTubeStartupWatchdog(activeTrack, videoId);
      forceYoutubePlayback(videoId);
    }
    return;
  }
  if (activeTrack.provider === "soundcloud" && soundCloudWidget) {
    if (desiredPausedState) {
      stopSoundCloudAutoplayRetry();
      soundCloudWidget.pause();
      stopPlaybackTimer();
    } else {
      forceSoundCloudPlayback(activeTrack.id);
    }
    return;
  }
  if (activeTrack.provider === "suno" && isSunoAudioPlayer(sunoAudio)) {
    if (desiredPausedState) {
      try {
        sunoAudio.pause();
      } catch {
      }
      stopPlaybackTimer();
    } else {
      const playPromise = sunoAudio.play();
      if (playPromise?.catch) {
        playPromise.catch((error) => {
          sendClientLog("error", "Failed resuming Suno playback", {
            id: activeTrack.id,
            title: activeTrack.title,
            message: error?.message ?? String(error)
          });
        });
      }
    }
  }
}
function loadTrack(track) {
  if (!track || track.id === currentTrackId) {
    return;
  }
  sendClientLog("info", "Preparing track for playback", {
    id: track.id,
    title: track.title,
    provider: track.provider,
    origin: track.origin
  });
  const previousTrack = activeTrack ?? handoffSourceTrack;
  const pendingReloadTrackId = getPendingSoundCloudToYoutubeReloadTrackId();
  const pendingConsecutiveSoundCloudReloadTrackId = getPendingConsecutiveSoundCloudReloadTrackId();
  if (previousTrack?.provider === "soundcloud" && track.provider === "youtube" && pendingReloadTrackId !== track.id) {
    reloadPageForSoundCloudToYoutubeHandoff(track);
    return;
  }
  if (previousTrack?.provider === "soundcloud" && track.provider === "soundcloud" && pendingConsecutiveSoundCloudReloadTrackId !== track.id) {
    reloadPageForConsecutiveSoundCloudHandoff(track);
    return;
  }
  clearPendingSoundCloudToYoutubeReloadTrackId(track.id);
  clearPendingConsecutiveSoundCloudReloadTrackId(track.id);
  resetYouTubeStartupRecoveryState(track.id);
  activeTrack = null;
  currentTrackId = null;
  lastReportedStatus = "";
  resetPlayers();
  if (previousTrack?.provider === "youtube" && track.provider === "soundcloud") {
    sendClientLog("info", "Hard resetting YouTube player for provider switch", {
      previousTrackId: previousTrack.id,
      nextTrackId: track.id
    });
    hardResetYouTubePlayer();
  }
  if (previousTrack?.provider === "soundcloud" && track.provider === "youtube") {
    sendClientLog("info", "Hard resetting players for SoundCloud to YouTube switch", {
      previousTrackId: previousTrack.id,
      nextTrackId: track.id
    });
    hardResetSoundCloudPlayer();
    hardResetYouTubePlayer();
  }
  activeTrack = track;
  currentTrackId = track.id;
  handoffSourceTrack = null;
  resetTimeline();
  if (track.provider === "soundcloud") {
    loadSoundCloudTrack(track);
    return;
  }
  if (track.provider === "suno") {
    loadSunoTrack(track);
    return;
  }
  if (track.provider === "youtube") {
    loadYoutubeTrack(track);
    return;
  }
  emitStatus("error", { reason: "unsupported_provider" });
}
window.onYouTubeIframeAPIReady = () => {
  sendClientLog("info", "YouTube IFrame API ready");
  youtubeApiReady = true;
  ensureYouTubePlayerReady();
};
window.addEventListener("resize", scheduleTitleMarqueeUpdate);
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) {
    return;
  }
  if (event.data?.type === "gui-player:set-volume") {
    setPlayerVolume(event.data.volume);
  }
});
if (document.fonts?.ready) {
  document.fonts.ready.then(() => {
    scheduleTitleMarqueeUpdate();
  }).catch(() => {
  });
}
if (socket) {
  socket.on("connect", handleSocketConnect);
  socket.on("disconnect", handleSocketDisconnect);
  socket.on("state", updateState);
  socket.on("player:load", ({ track }) => {
    sendClientLog("info", "Received player:load event", {
      trackId: track?.id ?? null,
      title: track?.title ?? null
    });
    if (isExternalPlaybackTrack(track)) {
      displayExternalPlaybackTrack(track);
      return;
    }
    loadTrack(track);
  });
  socket.on("player:stop", (payload = {}) => {
    sendClientLog("info", "Received player:stop event", {
      reason: payload?.reason ?? "",
      trackId: payload?.trackId ?? ""
    });
    if (payload?.reason === "obs_youtube_fallback") {
      resetPlayers();
      if (!payload?.trackId || payload.trackId === currentTrackId) {
        activeTrack = null;
        currentTrackId = null;
        lastReportedStatus = "";
      }
      return;
    }
    clearYouTubeStartupRecoveryAttempts(currentTrackId ?? "");
    rememberTrackForHandoff();
    activeTrack = null;
    currentTrackId = null;
    lastReportedStatus = "";
    desiredPausedState = false;
    resetPlayers();
  });
  socket.on("player:toggle-pause", ({ trackId, paused }) => {
    if (!trackId || trackId !== currentTrackId) {
      return;
    }
    desiredPausedState = Boolean(paused);
    syncPausedState();
  });
  socket.on("connect_error", () => {
    sendClientLog("error", "Socket connection error");
    handleSocketDisconnect();
  });
  socket.on("app:settings", (payload) => {
    const overlayScaleChanged = Object.prototype.hasOwnProperty.call(payload ?? {}, "overlayScalePercent") ? applyOverlayScale(payload.overlayScalePercent) : false;
    let themeChanged = false;
    if (typeof payload?.theme === "string" && payload.theme) {
      const previousTheme = document.documentElement.dataset.theme;
      applyOverlayTheme(payload.theme);
      themeChanged = payload.theme !== previousTheme;
    }
    if (themeChanged || overlayScaleChanged) {
      scheduleTitleMarqueeUpdate();
      requestAnimationFrame(() => reportOverlaySize());
    }
    if (Object.prototype.hasOwnProperty.call(payload ?? {}, "playerStartupTimeoutSeconds")) {
      applyStartupTimeoutSetting(payload.playerStartupTimeoutSeconds);
    }
  });
} else {
  sendClientLog("warn", "Socket.IO client was not available in the browser source");
}
sendClientLog("info", "Browser source script loaded", {
  userAgent: navigator.userAgent
});
if (window.YT?.Player) {
  sendClientLog("info", "YouTube API was already available on script load");
  ensureYouTubePlayerReady();
}
startSizeObserver();
requestAnimationFrame(() => {
  requestAnimationFrame(() => reportOverlaySize());
});
startStatePolling();
void fetchState().catch(() => {
  reportClientError("Could not reach the player service.");
});
