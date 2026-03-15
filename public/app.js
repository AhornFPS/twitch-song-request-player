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
let youtubeAutoplayRetryTimer = null;
let youtubeApiReady = false;
let youtubePlayerReady = false;
let youtubeEndedTrackId = "";
let displayedTrackId = null;
let trackExitTimer = null;
let trackEnterTimer = null;
let titleMarqueeFrame = null;
const soundCloudToYoutubeReloadKey = "soundcloud-to-youtube-reload-track";

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

function updateTitleMarquee() {
  if (!currentTitle || !currentTitleText || !currentTitleTextClone || !currentTitleMarquee) {
    return;
  }

  const titleWidth = currentTitle.clientWidth;
  const textWidth = currentTitleText.scrollWidth;
  const overflowAmount = Math.max(0, textWidth - titleWidth);

  currentTitle.classList.remove("is-marquee");
  currentTitle.style.removeProperty("--title-marquee-distance");
  currentTitle.style.removeProperty("--title-marquee-duration");
  currentTitleTextClone.textContent = currentTitleText.textContent;

  if (overflowAmount <= 8) {
    return;
  }

  const gapWidth = 180;
  const travelDistance = overflowAmount + gapWidth;
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

function startYouTubePlaybackTimer() {
  stopPlaybackTimer();
  playbackTimer = window.setInterval(() => {
    if (!youtubePlayer?.getCurrentTime || !youtubePlayer?.getDuration) {
      return;
    }

    updateTimeline(youtubePlayer.getCurrentTime(), youtubePlayer.getDuration());
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
          stopPlaybackTimer();
          emitStatus("ended");
        }
      },
      onError: (event) => {
        sendClientLog("error", "YouTube player error", {
          code: event.data,
          currentTrackId
        });
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

    youtubePlayer.unMute?.();
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
  stopPlaybackTimer();
  pendingYoutubeTrack = null;
  youtubePlayerReady = false;

  if (youtubePlayer) {
    try {
      youtubePlayer.mute?.();
      youtubePlayer.pauseVideo?.();
      youtubePlayer.stopVideo?.();
      youtubePlayer.clearVideo?.();
    } catch {
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
  stopSoundCloudDurationProbe();

  if (soundCloudWidget?.pause) {
    try {
      soundCloudWidget.pause();
    } catch {
    }
  }

  if (soundCloudWidget?.unbind && window.SC?.Widget?.Events) {
    try {
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
  if (currentTitleText) {
    currentTitleText.textContent = titleText;
  }
  if (currentTitleTextClone) {
    currentTitleTextClone.textContent = titleText;
  }
  scheduleTitleMarqueeUpdate();
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
  const currentTrack = state.currentTrack;
  const queue = state.queue ?? [];
  const stateSignature = JSON.stringify({
    currentTrackId: currentTrack?.id ?? null,
    queueLength: queue.length
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
    applyOverlayTheme(state.theme);
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
  } else if (currentTrackId) {
    activeTrack = null;
    currentTrackId = null;
    lastReportedStatus = "";
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
    const savedMarker = track.isSaved ? " • saved" : "";
    item.innerHTML = `<span class="queue-title">${track.title}</span><span class="queue-meta">${requester}${savedMarker}</span>`;
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
  stopSoundCloudDurationProbe();
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

  sendClientLog("info", "Loading SoundCloud track", {
    id: track.id,
    title: track.title,
    url: track.url
  });

  soundCloudFrame.style.display = "block";
  soundCloudFrame.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(track.url)}&auto_play=true&hide_related=true&show_artwork=false&visual=false`;
  soundCloudWidget = window.SC.Widget(soundCloudFrame);

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
    soundCloudWidget.play();
  });

  soundCloudWidget.bind(window.SC.Widget.Events.FINISH, () => {
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
      emitStatus("playing");
    }
  });
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
  forceYoutubePlayback(videoId);
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

  const previousTrack = activeTrack;
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
  activeTrack = track;
  currentTrackId = track.id;
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
    currentTrackId = null;
    lastReportedStatus = "";
    resetPlayers();
  });
  socket.on("connect_error", () => {
    sendClientLog("error", "Socket connection error");
    handleSocketDisconnect();
  });
  socket.on("app:settings", (payload) => {
    applyOverlayTheme(payload?.theme);
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
