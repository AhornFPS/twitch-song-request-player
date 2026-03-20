// @ts-nocheck
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
  }).catch(() => {});
}

const socket = typeof window.io === "function" ? window.io() : null;
const youtubeContainer = document.getElementById("youtube-player");
let soundCloudFrame = document.getElementById("soundcloud-player");
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
let soundCloudDurationProbeTimer = null;
let soundCloudAutoplayRetryTimer = null;
let soundCloudLoadTimeoutTimer = null;
let youtubeAutoplayRetryTimer = null;
let youtubeStartupWatchdogTimer = null;
let youtubeApiReady = false;
let youtubePlayerReady = false;
let youtubeEndedTrackId = "";
let youtubeStartupRecoveryTrackId = "";
let youtubeStartupHardResetAttempts = 0;
let displayedTrackId = null;
let trackExitTimer = null;
let trackEnterTimer = null;
let titleMarqueeFrame = null;
let titleMarqueeRetryTimer = null;
let desiredPausedState = false;
let handoffSourceTrack = null;
let overlayBuildToken = typeof window.__overlayBuildToken === "string"
  ? window.__overlayBuildToken
  : "";
let desiredPlayerVolume = 100;
let startupTimeoutMs = 15000;
const soundCloudToYoutubeReloadKey = "soundcloud-to-youtube-reload-track";
const youtubeStartupRecoveryStorageKey = "youtube-startup-recovery";

function applyOverlayTheme(themeId) {
  document.documentElement.dataset.theme = themeId || "aurora";
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
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0
    ? Math.floor(totalSeconds)
    : 0;
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
  startupTimeoutMs = timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0;
}

function applyYouTubeVolume() {
  if (!youtubePlayer) {
    return;
  }

  try {
    youtubePlayer.setVolume?.(desiredPlayerVolume);
    if (desiredPlayerVolume <= 0) {
      youtubePlayer.mute?.();
    } else {
      youtubePlayer.unMute?.();
    }
  } catch (error) {
    sendClientLog("warn", "Failed to apply YouTube volume", {
      message: error?.message ?? String(error),
      volume: desiredPlayerVolume
    });
  }
}

function applySoundCloudVolume() {
  if (!soundCloudWidget) {
    return;
  }

  try {
    soundCloudWidget.setVolume?.(desiredPlayerVolume);
  } catch (error) {
    sendClientLog("warn", "Failed to apply SoundCloud volume", {
      message: error?.message ?? String(error),
      volume: desiredPlayerVolume
    });
  }
}

function applyPlayerVolume() {
  applyYouTubeVolume();
  applySoundCloudVolume();
}

function setPlayerVolume(nextVolume) {
  desiredPlayerVolume = normalizePlayerVolume(nextVolume);
  applyPlayerVolume();
}

function updateTimeline(currentTimeSeconds, durationSeconds) {
  const current = Number.isFinite(currentTimeSeconds) ? Math.max(0, currentTimeSeconds) : currentPositionSeconds;
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.max(0, durationSeconds)
    : currentDurationSeconds;
  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  currentPositionSeconds = current;
  currentDurationSeconds = duration;
  currentTimeText.textContent = formatTime(current);
  durationTimeText.textContent = formatTime(duration);
  progressFill.style.width = `${progress}%`;
}

function resetTimeline() {
  currentPositionSeconds = 0;
  currentDurationSeconds = 0;
  updateTimeline(0, 0);
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
    if (
      !track?.id ||
      currentTrackId !== track.id ||
      activeTrack?.provider !== "soundcloud" ||
      activeTrack?.id !== track.id
    ) {
      return;
    }

    stopSoundCloudAutoplayRetry();
    stopSoundCloudDurationProbe();
    sendClientLog("error", "SoundCloud track load timed out", {
      trackId: track.id,
      title: track.title,
      url: track.url
    });
    reportClientError("This SoundCloud track could not be played in the embedded player.");
    emitStatus("error", { reason: "soundcloud_load_timeout" });
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

    return Number.isInteger(parsedValue.attempts) && parsedValue.attempts > 0
      ? parsedValue.attempts
      : 0;
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
  if (
    !track?.id ||
    desiredPausedState ||
    currentTrackId !== track.id ||
    activeTrack?.provider !== "youtube" ||
    activeTrack?.id !== track.id
  ) {
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
    if (
      currentTrackId !== track.id ||
      activeTrack?.provider !== "youtube" ||
      activeTrack?.id !== track.id
    ) {
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
  }, 1000);
}

function startYouTubePlaybackTimer() {
  stopPlaybackTimer();
  playbackTimer = window.setInterval(() => {
    if (!youtubePlayer?.getCurrentTime || !youtubePlayer?.getDuration) {
      return;
    }

    const currentTimeSeconds = youtubePlayer.getCurrentTime();
    updateTimeline(currentTimeSeconds, youtubePlayer.getDuration());

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
          updateTimeline(youtubePlayer.getCurrentTime(), youtubePlayer.getDuration());
          emitStatus("playing");
        }

        if (
          event.data === window.YT.PlayerState.PAUSED ||
          event.data === window.YT.PlayerState.BUFFERING
        ) {
          stopPlaybackTimer();
          updateTimeline(youtubePlayer.getCurrentTime(), youtubePlayer.getDuration());
        }

        if (
          event.data === window.YT.PlayerState.UNSTARTED ||
          event.data === window.YT.PlayerState.CUED
        ) {
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
    const loadedVideoId = loadedVideoUrl
      ? extractYouTubeVideoId(loadedVideoUrl)
      : null;
    const requestedVideoLoaded = !videoId || !loadedVideoId || loadedVideoId === videoId;

    if (
      playerState === window.YT?.PlayerState?.PLAYING &&
      requestedVideoLoaded
    ) {
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

function setArtwork(url, fallbackText = "SR") {
  if (url) {
    artworkImage.src = url;
    artworkImage.classList.add("is-visible");
    artworkFallback.classList.add("is-hidden");
  } else {
    artworkImage.removeAttribute("src");
    artworkImage.classList.remove("is-visible");
    artworkFallback.classList.remove("is-hidden");
    artworkFallback.textContent = fallbackText;
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

function describeTrackMeta(track) {
  if (!track) {
    return socketConnected
      ? "Queue is empty. Fallback playlist will play automatically."
      : "Connecting to the player service...";
  }

  if (track.origin === "playlist") {
    return track.provider === "youtube"
      ? "Playlist fallback from YouTube"
      : "Playlist fallback from SoundCloud";
  }

  const requester = track.requestedBy?.displayName || track.requestedBy?.username || "unknown";
  return `Requested by ${requester}`;
}

function applyStateToUi(state) {
  const currentTrack = state.currentTrack;
  const queue = state.queue ?? [];

  const titleText = currentTrack?.title ?? "Waiting for a track";
  const titleChanged =
    (currentTitleText?.textContent ?? "") !== titleText ||
    (currentTitleTextClone?.textContent ?? "") !== titleText;

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
  setMetaText(describeTrackMeta(currentTrack));
  providerBadge.textContent = currentTrack
    ? currentTrack.provider === "youtube"
      ? "YouTube"
      : "SoundCloud"
    : "Idle";
  saveBadge.textContent = currentTrack
    ? currentTrack.isSaved
      ? "Saved"
      : "Unsaved"
    : "Unsaved";
  saveBadge.className = currentTrack?.isSaved
    ? "save-badge save-badge--saved"
    : "save-badge save-badge--idle";
  setArtwork(
    resolveArtwork(currentTrack),
    currentTrack
      ? currentTrack.provider === "youtube"
        ? "YT"
        : "SC"
      : "SR"
  );

  queueCount.textContent = `${queue.length} queued`;
  renderQueue(queue);
  displayedTrackId = currentTrack?.id ?? null;
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

function updateState(state) {
  if (
    typeof state.overlayBuildToken === "string" &&
    state.overlayBuildToken &&
    overlayBuildToken &&
    state.overlayBuildToken !== overlayBuildToken
  ) {
    sendClientLog("warn", "Overlay build token changed, reloading browser source", {
      clientOverlayBuildToken: overlayBuildToken,
      serverOverlayBuildToken: state.overlayBuildToken
    });
    window.location.reload();
    return;
  }

  const currentTrack = state.currentTrack;
  const queue = state.queue ?? [];
  desiredPausedState = Boolean(currentTrack?.isPaused);
  const stateSignature = JSON.stringify({
    currentTrackId: currentTrack?.id ?? null,
    queueLength: queue.length,
    isPaused: Boolean(currentTrack?.isPaused)
  });

  if (stateSignature !== lastLoggedStateSignature) {
    lastLoggedStateSignature = stateSignature;
    sendClientLog("info", "State received", {
      currentTrack: currentTrack
        ? {
            id: currentTrack.id,
            title: currentTrack.title,
            provider: currentTrack.provider,
            origin: currentTrack.origin,
            isSaved: currentTrack.isSaved
          }
        : null,
      queueLength: queue.length
    });
  }

  if (typeof state.theme === "string" && state.theme) {
    const previousTheme = document.documentElement.dataset.theme;
    applyOverlayTheme(state.theme);
    if (state.theme !== previousTheme) {
      scheduleTitleMarqueeUpdate();
    }
  }

  if (Object.prototype.hasOwnProperty.call(state, "playerStartupTimeoutSeconds")) {
    applyStartupTimeoutSetting(state.playerStartupTimeoutSeconds);
  }

  if (displayedTrackId !== null && currentTrack?.id !== displayedTrackId) {
    animateUiToState(state);
  } else {
    stopTrackTransitionTimers();
    playerCard.classList.remove("is-track-exiting", "is-track-entering");
    applyStateToUi(state);
  }

  if (currentTrack) {
    loadTrack(currentTrack);
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
      id: track.id,
      title: track.title,
      requester:
        track.requestedBy?.displayName ||
        track.requestedBy?.username ||
        "playlist",
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
    const requester =
      track.requestedBy?.displayName || track.requestedBy?.username || "playlist";
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
    void fetchState();
  }, 3000);
}

function stopStatePolling() {
  if (!statePollTimer) {
    return;
  }

  window.clearInterval(statePollTimer);
  statePollTimer = null;
}

async function fetchState() {
  const response = await fetch("/api/state", {
    cache: "no-store"
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
  stopStatePolling();
  void fetchState().catch(() => {});
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

function emitStatus(status, extra = {}) {
  if (!currentTrackId) {
    return;
  }

  const dedupeKey = `${currentTrackId}:${status}`;
  if (lastReportedStatus === dedupeKey) {
    return;
  }

  lastReportedStatus = dedupeKey;
  const eventPayload = {
    trackId: currentTrackId,
    status,
    ...extra
  };

  if (socketConnected) {
    sendClientLog("info", "Sending player event over socket", eventPayload);
    socket.emit("player:event", eventPayload);
    return;
  }

  sendClientLog("warn", "Sending player event over HTTP fallback", eventPayload);
  postPlayerEvent(eventPayload).catch(() => {});
}

function resetPlayers() {
  youtubeEndedTrackId = "";
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

function loadSoundCloudTrack(track) {
  if (!window.SC?.Widget) {
    reportClientError("SoundCloud player API did not load in OBS.");
    return;
  }

  hardResetSoundCloudPlayer();
  sendClientLog("info", "Loading SoundCloud track", {
    id: track.id,
    title: track.title,
    url: track.url
  });

  soundCloudFrame.style.display = "block";
  soundCloudFrame.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(track.url)}&auto_play=true&hide_related=true&show_artwork=false&visual=false`;
  soundCloudWidget = window.SC.Widget(soundCloudFrame);
  scheduleSoundCloudLoadTimeout(track);

  const updateDurationFromSoundCloud = () => {
    if (!soundCloudWidget) {
      return;
    }

    soundCloudWidget.getDuration((durationMs) => {
      if (Number.isFinite(durationMs) && durationMs > 0) {
        updateTimeline(currentPositionSeconds, durationMs / 1000);
        stopSoundCloudDurationProbe();
      }
    });
  };

  soundCloudWidget.bind(window.SC.Widget.Events.READY, () => {
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
        updateTimeline(currentPositionSeconds, durationMs / 1000);
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
    stopSoundCloudLoadTimeout();
    stopSoundCloudAutoplayRetry();
    stopSoundCloudDurationProbe();
    sendClientLog("error", "SoundCloud widget error", {
      id: track.id,
      title: track.title,
      event
    });
    reportClientError("This SoundCloud track could not be played in the embedded player.");
    emitStatus("error", { reason: "soundcloud_widget_error" });
  });

  soundCloudWidget.bind(window.SC.Widget.Events.FINISH, () => {
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
    const currentSeconds = Number.isFinite(event.currentPosition) ? event.currentPosition / 1000 : currentPositionSeconds;
    const durationSeconds = Number.isFinite(event.duration) && event.duration > 0
      ? event.duration / 1000
      : currentDurationSeconds;
    updateTimeline(currentSeconds, durationSeconds);

    if (currentSeconds > 0) {
      stopSoundCloudLoadTimeout();
      stopSoundCloudAutoplayRetry();
      emitStatus("playing");
    }
  });
}

function forceSoundCloudPlayback(trackId, attempt = 0) {
  if (
    !soundCloudWidget ||
    !currentTrackId ||
    activeTrack?.provider !== "soundcloud" ||
    currentTrackId !== trackId
  ) {
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

function syncPausedState() {
  if (!currentTrackId || !activeTrack) {
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

  if (
    previousTrack?.provider === "soundcloud" &&
    track.provider === "youtube" &&
    pendingReloadTrackId !== track.id
  ) {
    reloadPageForSoundCloudToYoutubeHandoff(track);
    return;
  }

  clearPendingSoundCloudToYoutubeReloadTrackId(track.id);
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
  }).catch(() => {});
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
    loadTrack(track);
  });
  socket.on("player:stop", () => {
    sendClientLog("info", "Received player:stop event");
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
    applyOverlayTheme(payload?.theme);
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
startStatePolling();
void fetchState().catch(() => {
  reportClientError("Could not reach the player service.");
});
