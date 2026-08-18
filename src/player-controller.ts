// @ts-nocheck
import crypto from "node:crypto";
import { formatTrack, logInfo, logWarn } from "./logger.js";
import { tracksShareIdentity, trackTitlesOverlap } from "./track-identity.js";

const validRequestAccessLevels = new Set([
  "everyone",
  "subscriber",
  "vip",
  "moderator",
  "broadcaster"
]);

const validProviders = new Set([
  "youtube",
  "soundcloud",
  "spotify",
  "suno"
]);

const MAX_RADIO_TRACK_DURATION_SECONDS = 10 * 60;
const FALLBACK_PLAYLIST_FINISH_BUFFER_SECONDS = 2;

function normalizeRadioTrackCount(value, fallback = 3) {
  const parsedValue = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallback;
  }

  return Math.min(10, parsedValue);
}

function normalizeRequestPolicyList(value, { lowerCase = false } = {}) {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return Array.from(
    new Set(
      list
        .map((item) => typeof item === "string" ? item.trim() : "")
        .map((item) => lowerCase ? item.toLowerCase() : item)
        .filter(Boolean)
    )
  );
}

function normalizeAllowedProviders(value) {
  const sourceValue =
    Array.isArray(value) || typeof value === "string"
      ? value
      : ["youtube", "soundcloud", "spotify", "suno"];
  const allowedProviders = normalizeRequestPolicyList(sourceValue, {
    lowerCase: true
  }).filter((provider) => validProviders.has(provider));

  return allowedProviders;
}

function normalizeDurationSeconds(value) {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return Math.floor(parsedValue);
}

function normalizePlaybackRate(value) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 1;
}

function normalizeRequestPolicy(requestPolicy = {}) {
  const accessLevel = typeof requestPolicy.accessLevel === "string"
    ? requestPolicy.accessLevel.trim().toLowerCase()
    : "everyone";

  return {
    requestsEnabled: requestPolicy.requestsEnabled !== false,
    accessLevel: validRequestAccessLevels.has(accessLevel) ? accessLevel : "everyone",
    maxQueueLength: Number.parseInt(String(requestPolicy.maxQueueLength ?? 0), 10) || 0,
    maxRequestsPerUser: Number.parseInt(String(requestPolicy.maxRequestsPerUser ?? 0), 10) || 0,
    duplicateHistoryCount: Number.parseInt(String(requestPolicy.duplicateHistoryCount ?? 0), 10) || 0,
    cooldownSeconds: Number.parseInt(String(requestPolicy.cooldownSeconds ?? 0), 10) || 0,
    maxTrackDurationSeconds: Number.parseInt(String(requestPolicy.maxTrackDurationSeconds ?? 0), 10) || 0,
    rejectLiveStreams: requestPolicy.rejectLiveStreams === true,
    allowSearchRequests: requestPolicy.allowSearchRequests !== false,
    youtubeSafeSearch: typeof requestPolicy.youtubeSafeSearch === "string"
      ? requestPolicy.youtubeSafeSearch
      : "none",
    allowedProviders: normalizeAllowedProviders(requestPolicy.allowedProviders),
    blockedYouTubeChannelIds: normalizeRequestPolicyList(requestPolicy.blockedYouTubeChannelIds, {
      lowerCase: true
    }),
    blockedSoundCloudUsers: normalizeRequestPolicyList(requestPolicy.blockedSoundCloudUsers, {
      lowerCase: true
    }),
    blockedUsers: normalizeRequestPolicyList(requestPolicy.blockedUsers, {
      lowerCase: true
    }),
    blockedDomains: normalizeRequestPolicyList(requestPolicy.blockedDomains, {
      lowerCase: true
    }),
    blockedPhrases: normalizeRequestPolicyList(requestPolicy.blockedPhrases)
  };
}

function createRequestPolicyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export class PlayerController {
        constructor({
    io,
    playlistRepository,
    runtimeStateStore = null,
    requestAuditStore = null,
    historyLimit = 100,
    requestAuditLimit = 1000,
    requestPolicy = {},
    radioModeEnabled = true,
    radioTrackCount = 3,
    getRadioTracks = null,
    routeOwnedRequest = null,
    beforeTrackStart = null,
    externalPlayback = null,
    decorateBroadcastState = null,
    playbackConfirmationTimeoutMs = 20_000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  }) {
    this.io = io;
    this.playlistRepository = playlistRepository;
    this.runtimeStateStore = runtimeStateStore;
    this.requestAuditStore = requestAuditStore;
    this.historyLimit = historyLimit;
    this.requestAuditLimit = requestAuditLimit;
    this.requestPolicy = normalizeRequestPolicy(requestPolicy);
    this.radioModeEnabled = radioModeEnabled !== false;
    this.radioTrackCount = normalizeRadioTrackCount(radioTrackCount, 3);
    this.queue = [];
    this.radioQueue = [];
    this.currentTrack = null;
    this.stoppedTrack = null;
    this.history = [];
    this.adminEvents = [];
    this.requestEvents = [];
    this.requesterStatsByUser = new Map();
    this.isAdvancing = false;
    this.isPlaybackPaused = false;
    this.currentTrackStartedAt = 0;
    this.currentTrackElapsedSeconds = 0;
    this.fallbackPlaylistFinishTimer = null;
    this.playbackConfirmationTimer = null;
    this.playbackConfirmationRearmKey = "";
    this.externalPlaybackOutputGeneration = 0;
    const requestedPlaybackConfirmationTimeoutMs = Number(playbackConfirmationTimeoutMs);
    this.playbackConfirmationTimeoutMs = Number.isFinite(requestedPlaybackConfirmationTimeoutMs)
      ? Math.max(0, Math.min(120_000, requestedPlaybackConfirmationTimeoutMs))
      : 20_000;
    this.fallbackPlaylistFinishBufferSeconds = FALLBACK_PLAYLIST_FINISH_BUFFER_SECONDS;
    this.playbackSuppressed = false;
    this.playbackSuppressedCategory = "";
    this.trackStartListeners = new Set();
    this.trackPlaybackListeners = new Set();
    this.trackFinishListeners = new Set();
    this.playbackIdleListeners = new Set();
    this.requestTimestampsByUser = new Map();
    this.getRadioTracks = typeof getRadioTracks === "function" ? getRadioTracks : null;
    this.routeOwnedRequest = typeof routeOwnedRequest === "function" ? routeOwnedRequest : null;
    this.beforeTrackStart = typeof beforeTrackStart === "function" ? beforeTrackStart : null;
    this.ownedRequestRetryTimers = new Map();
    this.externalPlayback = externalPlayback;
    this.decorateBroadcastState = typeof decorateBroadcastState === "function"
      ? decorateBroadcastState
      : null;
    this.unconfirmedRequestSelection = null;
    this.externalOutputRecovery = null;
    this.externalOutputRecoveryTimer = null;
    this.externalOutputRecoveryPersistenceTimer = null;
    this.externalOutputRecoveryGeneration = 0;
    this.browserPlaybackPreparation = null;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
  }

  clampElapsedSeconds(track, value) {
    const safeValue = Number.isFinite(value) ? Math.max(value, 0) : 0;
    const durationSeconds = Number.isFinite(track?.durationSeconds)
      ? Math.max(track.durationSeconds, 0)
      : null;

    if (durationSeconds === null) {
      return safeValue;
    }

    return Math.min(safeValue, durationSeconds);
  }

  getTrackElapsedSeconds(track) {
    if (!track) {
      return null;
    }

    if (track.id === this.currentTrack?.id) {
      let elapsedSeconds = this.currentTrackElapsedSeconds;

      if (!this.isPlaybackPaused && this.currentTrackStartedAt > 0) {
        elapsedSeconds += (
          (Date.now() - this.currentTrackStartedAt) / 1000
        ) * normalizePlaybackRate(track.playbackRate);
      }

      return this.clampElapsedSeconds(track, elapsedSeconds);
    }

    return this.clampElapsedSeconds(track, track.elapsedSeconds);
  }

  captureCurrentTrackElapsedSeconds() {
    if (!this.currentTrack) {
      return 0;
    }

    const elapsedSeconds = this.getTrackElapsedSeconds(this.currentTrack) ?? 0;

    this.currentTrackElapsedSeconds = elapsedSeconds;
    this.currentTrack.elapsedSeconds = elapsedSeconds;
    this.currentTrackStartedAt = 0;

    return elapsedSeconds;
  }

  resetCurrentTrackProgress() {
    this.clearFallbackPlaylistFinishTimer();
    this.clearPlaybackConfirmationTimer();
    this.clearPlaybackConfirmationRearm();
    this.currentTrackStartedAt = 0;
    this.currentTrackElapsedSeconds = 0;
  }

  clearFallbackPlaylistFinishTimer() {
    if (!this.fallbackPlaylistFinishTimer) {
      return;
    }

    clearTimeout(this.fallbackPlaylistFinishTimer);
    this.fallbackPlaylistFinishTimer = null;
  }

  clearPlaybackConfirmationTimer() {
    if (!this.playbackConfirmationTimer) {
      return;
    }
    this.clearTimeoutFn(this.playbackConfirmationTimer);
    this.playbackConfirmationTimer = null;
  }

  clearPlaybackConfirmationRearm() {
    this.playbackConfirmationRearmKey = "";
  }

  schedulePlaybackConfirmationTimer(track = this.currentTrack) {
    this.clearPlaybackConfirmationTimer();
    if (!track?.id || track.playbackConfirmed || this.playbackConfirmationTimeoutMs <= 0) {
      return false;
    }
    const trackId = track.id;
    this.playbackConfirmationTimer = this.setTimeoutFn(() => {
      this.playbackConfirmationTimer = null;
      if (
        this.currentTrack?.id !== trackId ||
        this.currentTrack.playbackConfirmed ||
        this.isPlaybackPaused
      ) {
        return;
      }
      logWarn("Playback client did not confirm the selected track in time", {
        track: formatTrack(this.currentTrack),
        timeoutMs: this.playbackConfirmationTimeoutMs
      });
      void this.handlePlayerEvent({
        trackId,
        status: "error",
        reason: "playback_confirmation_timeout",
        message: "The playback client did not confirm that audio started."
      }, {
        trustedInternalReason: "playback_confirmation_timeout"
      }).catch((error) => {
        logWarn("Could not recover from an unconfirmed playback start", {
          track: formatTrack(this.currentTrack),
          message: error?.message ?? String(error)
        });
      });
    }, this.playbackConfirmationTimeoutMs);
    this.playbackConfirmationTimer?.unref?.();
    return true;
  }

  shouldUseFallbackFinishTimer(track) {
    if (!track) {
      return false;
    }

    return track.origin === "playlist" || this.isExternalPlaybackActiveForTrack(track);
  }

  scheduleFallbackPlaylistFinishTimer() {
    this.clearFallbackPlaylistFinishTimer();

    const track = this.currentTrack;
    if (
      !track ||
      !this.shouldUseFallbackFinishTimer(track) ||
      !track.playbackConfirmed ||
      this.isPlaybackPaused
    ) {
      return;
    }

    const durationSeconds = normalizeDurationSeconds(track.durationSeconds);
    if (durationSeconds === null) {
      return;
    }

    const elapsedSeconds = this.getTrackElapsedSeconds(track) ?? 0;
    const bufferSeconds = Number.isFinite(this.fallbackPlaylistFinishBufferSeconds)
      ? Math.max(this.fallbackPlaylistFinishBufferSeconds, 0)
      : FALLBACK_PLAYLIST_FINISH_BUFFER_SECONDS;
    const playbackRate = normalizePlaybackRate(track.playbackRate);
    const delayMs = Math.max(0, ((durationSeconds - elapsedSeconds) / playbackRate + bufferSeconds) * 1000);
    const trackId = track.id;

    this.fallbackPlaylistFinishTimer = setTimeout(() => {
      this.fallbackPlaylistFinishTimer = null;

      if (
        !this.currentTrack ||
        this.currentTrack.id !== trackId ||
        !this.shouldUseFallbackFinishTimer(this.currentTrack) ||
        this.isPlaybackPaused
      ) {
        return;
      }

      const currentDurationSeconds = normalizeDurationSeconds(this.currentTrack.durationSeconds);
      const currentElapsedSeconds = this.getTrackElapsedSeconds(this.currentTrack) ?? 0;
      if (
        currentDurationSeconds !== null &&
        currentElapsedSeconds + 0.25 < currentDurationSeconds
      ) {
        this.scheduleFallbackPlaylistFinishTimer();
        return;
      }

      logInfo("Fallback finish timer advanced current track", {
        track: formatTrack(this.currentTrack),
        elapsedSeconds: currentElapsedSeconds,
        durationSeconds: currentDurationSeconds
      });

      void this.finishCurrentTrack({
        trackId,
        status: "ended",
        reason: this.isExternalPlaybackActiveForTrack(this.currentTrack)
          ? "external_fallback_timer"
          : "fallback_playlist_timer"
      }).catch((error) => {
        logWarn("Failed to advance fallback track from finish timer", {
          track: formatTrack(this.currentTrack),
          message: error?.message ?? String(error)
        });
      });
    }, delayMs);
    this.fallbackPlaylistFinishTimer.unref?.();
  }

  serializeTrack(track) {
    if (!track) {
      return null;
    }

    const serializedTrack = {
      id: track.id,
      provider: track.provider,
      url: track.url,
      title: track.title,
      artist: track.artist ?? "",
      trackTitle: track.trackTitle ?? "",
      key: track.key,
      origin: track.origin,
      artworkUrl: track.artworkUrl ?? "",
      audioUrl: track.audioUrl ?? "",
      soundCloudResourceUrl: track.soundCloudResourceUrl ?? "",
      durationSeconds: Number.isFinite(track.durationSeconds) ? track.durationSeconds : null,
      elapsedSeconds: this.getTrackElapsedSeconds(track),
      requestedFromProvider: track.requestedFromProvider ?? "",
      requestedFromUrl: track.requestedFromUrl ?? "",
      requestedFromTitle: track.requestedFromTitle ?? "",
      requestedFromName: track.requestedFromName ?? "",
      requestedFromKey: track.requestedFromKey ?? "",
      requestedBy: track.requestedBy,
      ...(typeof track.preservePitch === "boolean"
        ? { preservePitch: track.preservePitch }
        : {}),
      ...(normalizePlaybackRate(track.playbackRate) !== 1
        ? { playbackRate: normalizePlaybackRate(track.playbackRate) }
        : {}),
      isSaved: this.playlistRepository.hasTrack(track),
      isPaused: track.id === this.currentTrack?.id ? this.isPlaybackPaused : false
    };

    if (track.id === this.currentTrack?.id && this.isExternalPlaybackActiveForTrack(track)) {
      serializedTrack.playbackMode = "external";
      serializedTrack.playbackProvider = "obs_youtube_fallback";
    }

    return serializedTrack;
  }

  serializePlaybackTrack(track) {
    return this.serializeTrack(track);
  }

  getOnlineRequestQueueKey(track) {
    const key = typeof track?.key === "string" ? track.key.trim() : "";
    if (key) {
      return `key:${key}`;
    }
    const id = typeof track?.id === "string" ? track.id.trim() : "";
    return id ? `id:${id}` : "";
  }

  getPublicState() {
    return {
      currentTrack: this.serializeTrack(this.currentTrack),
      stoppedTrack: this.serializeTrack(this.stoppedTrack),
      playbackStatus: this.getPlaybackStatus(),
      queue: this.queue.map((track) => this.serializeTrack(track)),
      radioQueue: this.radioQueue.map((track) => this.serializeTrack(track)),
      history: this.history.map((entry) => ({
        track: this.serializeTrack(entry.track),
        status: entry.status,
        completedAt: entry.completedAt
      })),
      adminEvents: this.adminEvents.map((entry) => ({
        action: entry.action,
        triggeredBy: entry.triggeredBy,
        track: this.serializeTrack(entry.track),
        details: entry.details,
        createdAt: entry.createdAt
      }))
    };
  }

  getBroadcastState() {
    const state = this.getPublicState();
    if (!this.decorateBroadcastState) {
      return state;
    }
    try {
      return this.decorateBroadcastState(state) ?? state;
    } catch (error) {
      logWarn("Could not compose the public playback presentation", {
        message: error?.message ?? String(error)
      });
      return state;
    }
  }

  serializeRequester(requester) {
    if (!requester || typeof requester !== "object") {
      return null;
    }

    const username = typeof requester.username === "string" ? requester.username : "";
    const displayName = typeof requester.displayName === "string" ? requester.displayName : "";

    if (!username && !displayName) {
      return null;
    }

    return {
      username,
      displayName
    };
  }

  serializeRequestAuditTrack(track) {
    if (!track || typeof track !== "object") {
      return null;
    }

    const provider = typeof track.provider === "string" ? track.provider : "";
    const url = typeof track.url === "string" ? track.url : "";
    const title = typeof track.title === "string" ? track.title : "";
    const key = typeof track.key === "string" ? track.key : "";

    if (!provider && !url && !title && !key) {
      return null;
    }

    return {
      id: typeof track.id === "string" ? track.id : "",
      provider,
      url,
      title,
      artist: typeof track.artist === "string" ? track.artist : "",
      trackTitle: typeof track.trackTitle === "string" ? track.trackTitle : "",
      key,
      origin: typeof track.origin === "string" ? track.origin : "",
      artworkUrl: typeof track.artworkUrl === "string" ? track.artworkUrl : "",
      soundCloudResourceUrl: typeof track.soundCloudResourceUrl === "string" ? track.soundCloudResourceUrl : "",
      requestedFromProvider: typeof track.requestedFromProvider === "string" ? track.requestedFromProvider : "",
      requestedFromUrl: typeof track.requestedFromUrl === "string" ? track.requestedFromUrl : "",
      requestedFromTitle: typeof track.requestedFromTitle === "string" ? track.requestedFromTitle : "",
      requestedFromName: typeof track.requestedFromName === "string" ? track.requestedFromName : "",
      requestedFromKey: typeof track.requestedFromKey === "string" ? track.requestedFromKey : "",
      durationSeconds: Number.isFinite(track.durationSeconds) ? track.durationSeconds : null,
      isLive: track.isLive === true,
      sourceName: typeof track.sourceName === "string" ? track.sourceName : "",
      sourceChannelId: typeof track.sourceChannelId === "string" ? track.sourceChannelId : "",
      sourceUrl: typeof track.sourceUrl === "string" ? track.sourceUrl : ""
    };
  }

  getRequesterAuditKey(requester) {
    const username = requester?.username?.trim().toLowerCase();
    if (username) {
      return username;
    }

    const displayName = requester?.displayName?.trim().toLowerCase();
    if (displayName) {
      return displayName;
    }

    return "";
  }

  buildRequestAuditQueueState() {
    return {
      playbackStatus: this.getPlaybackStatus(),
      queueLength: this.queue.length,
      currentTrackId: this.currentTrack?.id ?? "",
      stoppedTrackId: this.stoppedTrack?.id ?? ""
    };
  }

  cloneRequesterStatsEntry(entry) {
    if (!entry) {
      return null;
    }

    return {
      requester: entry.requester ? { ...entry.requester } : null,
      totalRequests: entry.totalRequests,
      acceptedRequests: entry.acceptedRequests,
      duplicateRequests: entry.duplicateRequests,
      rejectedRequests: entry.rejectedRequests,
      youtubeRequests: entry.youtubeRequests,
      soundcloudRequests: entry.soundcloudRequests,
      lastRequestedAt: entry.lastRequestedAt,
      lastAcceptedAt: entry.lastAcceptedAt,
      lastOutcome: entry.lastOutcome,
      lastSource: entry.lastSource,
      lastInput: entry.lastInput,
      lastTrackKey: entry.lastTrackKey,
      lastTrackTitle: entry.lastTrackTitle
    };
  }

  getRequestAuditState() {
    return {
      events: this.requestEvents.map((event) => ({
        ...event,
        requester: event.requester ? { ...event.requester } : null,
        track: event.track ? { ...event.track } : null,
        queueState: event.queueState ? { ...event.queueState } : null,
        requesterStats: event.requesterStats
          ? this.cloneRequesterStatsEntry(event.requesterStats)
          : null,
        details: event.details && typeof event.details === "object"
          ? JSON.parse(JSON.stringify(event.details))
          : null
      })),
      requesterStats: Array.from(this.requesterStatsByUser.values())
        .map((entry) => this.cloneRequesterStatsEntry(entry))
        .sort((left, right) => {
          const totalDifference = right.totalRequests - left.totalRequests;
          if (totalDifference !== 0) {
            return totalDifference;
          }

          return String(right.lastRequestedAt ?? "").localeCompare(String(left.lastRequestedAt ?? ""));
        })
    };
  }

  getActiveRequestCountForRequester(username) {
    const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
    if (!normalizedUsername) {
      return 0;
    }

    return [
      ...this.queue,
      this.currentTrack,
      this.stoppedTrack
    ].filter((candidate) => {
      if (!candidate || candidate.origin !== "queue") {
        return false;
      }

      return candidate.requestedBy?.username?.trim().toLowerCase() === normalizedUsername;
    }).length;
  }

  buildRequestAuditDetails(details) {
    if (!details || typeof details !== "object") {
      return null;
    }

    return JSON.parse(JSON.stringify(details));
  }

  updateRequesterStats({
    requester,
    track = null,
    outcome = "rejected",
    source = "unknown",
    input = "",
    createdAt
  }) {
    const requesterIdentity = this.serializeRequester(requester);
    if (!requesterIdentity) {
      return null;
    }

    const requesterKey = this.getRequesterAuditKey(requesterIdentity);
    if (!requesterKey) {
      return null;
    }

    const existingEntry = this.requesterStatsByUser.get(requesterKey) ?? {
      requester: requesterIdentity,
      totalRequests: 0,
      acceptedRequests: 0,
      duplicateRequests: 0,
      rejectedRequests: 0,
      youtubeRequests: 0,
      soundcloudRequests: 0,
      lastRequestedAt: null,
      lastAcceptedAt: null,
      lastOutcome: "",
      lastSource: "",
      lastInput: "",
      lastTrackKey: "",
      lastTrackTitle: ""
    };

    existingEntry.requester = requesterIdentity;
    existingEntry.totalRequests += 1;
    existingEntry.lastRequestedAt = createdAt;
    existingEntry.lastOutcome = outcome;
    existingEntry.lastSource = source;
    existingEntry.lastInput = typeof input === "string" ? input : "";
    existingEntry.lastTrackKey = typeof track?.key === "string" ? track.key : "";
    existingEntry.lastTrackTitle = typeof track?.title === "string" ? track.title : "";

    if (track?.provider === "youtube") {
      existingEntry.youtubeRequests += 1;
    } else if (track?.provider === "soundcloud") {
      existingEntry.soundcloudRequests += 1;
    }

    if (outcome === "accepted") {
      existingEntry.acceptedRequests += 1;
      existingEntry.lastAcceptedAt = createdAt;
    } else if (outcome === "duplicate") {
      existingEntry.duplicateRequests += 1;
    } else {
      existingEntry.rejectedRequests += 1;
    }

    this.requesterStatsByUser.set(requesterKey, existingEntry);
    return this.cloneRequesterStatsEntry(existingEntry);
  }

  async recordRequestOutcome({
    source = "unknown",
    outcome = "rejected",
    reason = "",
    message = "",
    input = "",
    requestedBy = null,
    track = null,
    bypassRequestLimits = false,
    details = null
  } = {}) {
    const createdAt = new Date().toISOString();
    const serializedRequester = this.serializeRequester(requestedBy);
    const serializedTrack = this.serializeRequestAuditTrack(track);
    const requesterStats = this.updateRequesterStats({
      requester: serializedRequester,
      track: serializedTrack,
      outcome,
      source,
      input,
      createdAt
    });

    this.requestEvents.unshift({
      id: crypto.randomUUID(),
      createdAt,
      source,
      outcome,
      reason,
      message,
      input,
      bypassRequestLimits: Boolean(bypassRequestLimits),
      requester: serializedRequester,
      track: serializedTrack,
      queueState: this.buildRequestAuditQueueState(),
      requesterStats,
      details: this.buildRequestAuditDetails(details)
    });

    if (this.requestEvents.length > this.requestAuditLimit) {
      this.requestEvents.length = this.requestAuditLimit;
    }

    logInfo("Recorded request audit event", {
      source,
      outcome,
      reason,
      requester: serializedRequester,
      track: formatTrack(serializedTrack),
      queueLength: this.queue.length
    });

    await this.persistRequestAuditState();
    return this.requestEvents[0];
  }

  getPlaybackStatus() {
    if (this.currentTrack) {
      return this.isPlaybackPaused ? "paused" : "playing";
    }

    if (this.stoppedTrack) {
      return "stopped";
    }

    return "idle";
  }

  async handleSocketConnection(socket) {
    logInfo("Browser source connected", {
      socketId: socket.id,
      currentTrack: formatTrack(this.currentTrack),
      queueLength: this.queue.length
    });
    socket.on("player:event", async (payload) => {
      await this.handlePlayerEvent(payload);
    });

    if (socket.handshake?.auth?.playbackClientRole === "obs") {
      const playbackReady = await this.prepareBrowserPlayback();
      if (!playbackReady) {
        logWarn("Deferring OBS browser-source playback until fallback cleanup succeeds", {
          socketId: socket.id,
          currentTrack: formatTrack(this.currentTrack)
        });
        return;
      }
    }

    socket.emit("state", this.getPublicState());

    if (this.currentTrack && !this.isExternalPlaybackActiveForTrack(this.currentTrack)) {
      logInfo("Sending current track to newly connected browser source", {
        socketId: socket.id,
        track: formatTrack(this.currentTrack)
      });
      socket.emit("player:load", {
        track: this.serializeTrack(this.currentTrack)
      });
    }

  }

  async prepareBrowserPlayback() {
    if (
      !this.currentTrack ||
      !this.externalPlayback?.needsSourceClear?.() ||
      this.isExternalPlaybackActiveForTrack(this.currentTrack)
    ) {
      return true;
    }

    if (!this.browserPlaybackPreparation) {
      this.browserPlaybackPreparation = this.clearExternalPlaybackSource({
        reason: "obs_browser_source_connected"
      }).finally(() => {
        this.browserPlaybackPreparation = null;
      });
    }

    const sourceCleared = await this.browserPlaybackPreparation;
    return sourceCleared !== false && !this.externalPlayback.needsSourceClear?.();
  }

  setRequestPolicy(requestPolicy = {}) {
    this.requestPolicy = normalizeRequestPolicy(requestPolicy);
  }

  async setRadioSettings({
    enabled = this.radioModeEnabled,
    trackCount = this.radioTrackCount
  } = {}) {
    const previousEnabled = this.radioModeEnabled;
    const previousTrackCount = this.radioTrackCount;
    const previousQueueLength = this.radioQueue.length;

    this.radioModeEnabled = enabled !== false;
    this.radioTrackCount = normalizeRadioTrackCount(trackCount, this.radioTrackCount);

    if (!this.radioModeEnabled) {
      this.radioQueue = [];
    } else if (this.radioQueue.length > this.radioTrackCount) {
      this.radioQueue = this.radioQueue.slice(0, this.radioTrackCount);
    }

    if (
      previousEnabled !== this.radioModeEnabled ||
      previousTrackCount !== this.radioTrackCount ||
      previousQueueLength !== this.radioQueue.length
    ) {
      await this.persistRuntimeState();
      this.broadcastState();
    }
  }

  recordAdminEvent(action, {
    triggeredBy = "unknown",
    track = null,
    details = null
  } = {}) {
    this.adminEvents.unshift({
      action,
      triggeredBy,
      track: track
        ? {
            id: track.id ?? "",
            provider: track.provider ?? "",
            url: track.url ?? "",
            title: track.title ?? "",
            key: track.key ?? "",
            origin: track.origin ?? "queue",
            artworkUrl: track.artworkUrl ?? "",
            soundCloudResourceUrl: track.soundCloudResourceUrl ?? "",
            requestedFromProvider: track.requestedFromProvider ?? "",
            requestedFromUrl: track.requestedFromUrl ?? "",
            requestedFromTitle: track.requestedFromTitle ?? "",
            requestedFromName: track.requestedFromName ?? "",
            requestedFromKey: track.requestedFromKey ?? "",
            requestedBy: track.requestedBy ?? null
          }
        : null,
      details: details && typeof details === "object"
        ? details
        : null,
      createdAt: new Date().toISOString()
    });

    if (this.adminEvents.length > 50) {
      this.adminEvents.length = 50;
    }
  }

  clearOwnedRequestRecheck(trackId) {
    const timer = this.ownedRequestRetryTimers.get(trackId);
    if (timer) {
      this.clearTimeoutFn(timer);
      this.ownedRequestRetryTimers.delete(trackId);
    }
  }

  async checkOwnedRequest(track) {
    if (!this.routeOwnedRequest || !["youtube", "suno", "soundcloud"].includes(track?.provider)) {
      return null;
    }
    return this.routeOwnedRequest(track);
  }

  scheduleOwnedRequestRecheck(track, attempt = 0) {
    if (!track?.id || !this.routeOwnedRequest) {
      return;
    }
    this.clearOwnedRequestRecheck(track.id);
    const delays = [5_000, 15_000, 30_000, 60_000];
    const delayMs = delays[Math.min(attempt, delays.length - 1)];
    const timer = this.setTimeoutFn(() => {
      this.ownedRequestRetryTimers.delete(track.id);
      void this.recheckOwnedQueuedRequest(track.id, attempt).catch((error) => {
        logWarn("Could not recheck queued request ownership", {
          track: formatTrack(track),
          message: error?.message ?? String(error)
        });
      });
    }, delayMs);
    timer?.unref?.();
    this.ownedRequestRetryTimers.set(track.id, timer);
  }

  async recheckOwnedQueuedRequest(trackId, attempt = 0) {
    const index = this.queue.findIndex((candidate) => candidate.id === trackId);
    if (index < 0) {
      this.clearOwnedRequestRecheck(trackId);
      return false;
    }
    const track = this.queue[index];
    let result = null;
    try {
      result = await this.checkOwnedRequest(track);
    } catch (error) {
      logWarn("AutoDJ ownership recheck is temporarily unavailable", {
        track: formatTrack(track),
        message: error?.message ?? String(error)
      });
    }
    const currentIndex = this.queue.findIndex((candidate) => candidate.id === trackId);
    if (result?.matched === true && currentIndex >= 0 && this.currentTrack?.id !== trackId) {
      const [matchedTrack] = this.queue.splice(currentIndex, 1);
      this.clearOwnedRequestRecheck(trackId);
      await this.recordRequestOutcome({
        source: "autodj_owned_recheck",
        outcome: "accepted",
        reason: "autodj_owned_late_match",
        requestedBy: matchedTrack.requestedBy,
        track: matchedTrack,
        details: { match: result.match ?? null }
      });
      await this.persistRuntimeState();
      this.broadcastState();
      return true;
    }
    if (currentIndex >= 0) {
      this.scheduleOwnedRequestRecheck(track, attempt + 1);
    }
    return false;
  }

  async addRequest(track, {
    bypassRequestLimits = false,
    requestSource = "unknown",
    requestInput = "",
    requestContext = null
  } = {}) {
    const duplicateMatch = this.findDuplicateTrack(track.key);

    if (duplicateMatch) {
      logInfo("Ignoring duplicate track request", {
        requestedTrack: formatTrack(track),
        duplicateTrack: formatTrack(duplicateMatch.track),
        duplicateType: duplicateMatch.type,
        queueLength: this.queue.length
      });

      await this.recordRequestOutcome({
        source: requestSource,
        outcome: "duplicate",
        reason: `duplicate_${duplicateMatch.type}`,
        input: requestInput,
        requestedBy: track.requestedBy,
        track,
        bypassRequestLimits,
        details: {
          duplicateType: duplicateMatch.type,
          matchedTrack: this.serializeRequestAuditTrack(duplicateMatch.track),
          requestContext
        }
      });

      return {
        ...this.serializeTrack(duplicateMatch.track),
        alreadyQueued: duplicateMatch.type === "queue",
        duplicateType: duplicateMatch.type
      };
    }

    try {
      this.assertRequestAllowed(track, { bypassRequestLimits });
    } catch (error) {
      await this.recordRequestOutcome({
        source: requestSource,
        outcome: "rejected",
        reason: error?.code ?? "request_rejected",
        message: error?.message ?? String(error),
        input: requestInput,
        requestedBy: track.requestedBy,
        track,
        bypassRequestLimits,
        details: {
          requestContext
        }
      });
      throw error;
    }

    if (this.routeOwnedRequest) {
      let routed = null;
      try {
        routed = await this.routeOwnedRequest(track);
      } catch (error) {
        logWarn("Could not check the AutoDJ owned-track queue; using normal request playback", {
          track: formatTrack(track),
          message: error?.message ?? String(error)
        });
      }

      if (routed?.matched === true && routed.track) {
        const routedTrack = {
          ...routed.track,
          requestedBy: routed.track.requestedBy ?? track.requestedBy ?? null
        };
        const duplicateType = routedTrack.duplicateType ?? routed.duplicateType ?? null;
        if (duplicateType) {
          await this.recordRequestOutcome({
            source: requestSource,
            outcome: "duplicate",
            reason: `autodj_owned_duplicate_${duplicateType}`,
            input: requestInput,
            requestedBy: track.requestedBy,
            track,
            bypassRequestLimits,
            details: {
              duplicateType,
              matchedLocalTrack: this.serializeRequestAuditTrack(routedTrack),
              match: routed.match ?? null,
              requestContext
            }
          });
          return {
            ...routedTrack,
            queuedForAutoDj: true,
            alreadyQueued: duplicateType === "queue",
            duplicateType
          };
        }

        const requesterUsername = track.requestedBy?.username?.trim().toLowerCase();
        if (!bypassRequestLimits && requesterUsername) {
          this.requestTimestampsByUser.set(requesterUsername, Date.now());
        }
        await this.recordRequestOutcome({
          source: requestSource,
          outcome: "accepted",
          reason: "autodj_owned_queued",
          input: requestInput,
          requestedBy: track.requestedBy,
          track,
          bypassRequestLimits,
          details: {
            queuePosition: routedTrack.queuePosition ?? routed.queuePosition ?? 1,
            matchedLocalTrack: this.serializeRequestAuditTrack(routedTrack),
            match: routed.match ?? null,
            requestContext
          }
        });
        this.broadcastState();
        return {
          ...routedTrack,
          queuedForAutoDj: true,
          alreadyQueued: false,
          duplicateType: null
        };
      }
    }

    const queueTrack = {
      ...track,
      id: crypto.randomUUID(),
      origin: "queue",
      radioSeedInput: typeof requestInput === "string" ? requestInput.trim() : ""
    };

    this.queue.push(queueTrack);
    const requesterUsername = track.requestedBy?.username?.trim().toLowerCase();
    if (!bypassRequestLimits && requesterUsername) {
      this.requestTimestampsByUser.set(requesterUsername, Date.now());
    }
    logInfo("Track queued", {
      track: formatTrack(queueTrack),
      queueLength: this.queue.length
    });
    await this.recordRequestOutcome({
      source: requestSource,
      outcome: "accepted",
      reason: "queued",
      input: requestInput,
      requestedBy: queueTrack.requestedBy,
      track: queueTrack,
      bypassRequestLimits,
      details: {
        queuePosition: this.queue.length,
        activeRequestsForRequester: this.getActiveRequestCountForRequester(requesterUsername),
        requestContext
      }
    });
    await this.persistRuntimeState();
    this.broadcastState();
    this.scheduleOwnedRequestRecheck(queueTrack);
    await this.ensurePlayback();

    return {
      ...this.serializeTrack(queueTrack),
      alreadyQueued: false,
      duplicateType: null
    };
  }

  assertRequestAllowed(track, { bypassRequestLimits = false } = {}) {
    if (
      track?.provider === "youtube" &&
      track.isEmbeddable === false &&
      !this.externalPlayback?.canPlayBlockedYouTube?.(track)
    ) {
      throw createRequestPolicyError(
        "youtube_embed_blocked",
        "That YouTube video cannot be played in the embedded player."
      );
    }

    if (bypassRequestLimits) {
      return;
    }

    const maxQueueLength = Number.isInteger(this.requestPolicy.maxQueueLength)
      ? this.requestPolicy.maxQueueLength
      : 0;
    const maxRequestsPerUser = Number.isInteger(this.requestPolicy.maxRequestsPerUser)
      ? this.requestPolicy.maxRequestsPerUser
      : 0;
    const cooldownSeconds = Number.isInteger(this.requestPolicy.cooldownSeconds)
      ? this.requestPolicy.cooldownSeconds
      : 0;

    if (maxQueueLength > 0 && this.queue.length >= maxQueueLength) {
      throw createRequestPolicyError("queue_full", "The request queue is full right now.");
    }

    const requesterUsername = track.requestedBy?.username?.trim().toLowerCase();
    if (!requesterUsername) {
      return;
    }

    if (cooldownSeconds > 0) {
      const lastRequestedAt = this.requestTimestampsByUser.get(requesterUsername) ?? 0;
      const cooldownMs = cooldownSeconds * 1000;
      const remainingMs = lastRequestedAt + cooldownMs - Date.now();

      if (remainingMs > 0) {
        const remainingSeconds = Math.ceil(remainingMs / 1000);
        throw createRequestPolicyError(
          "cooldown_active",
          `You need to wait ${remainingSeconds} more second${remainingSeconds === 1 ? "" : "s"} before requesting another song.`
        );
      }
    }

    if (maxRequestsPerUser <= 0) {
      return;
    }

    const activeRequestCount = this.getActiveRequestCountForRequester(requesterUsername);

    if (activeRequestCount >= maxRequestsPerUser) {
      throw createRequestPolicyError("too_many_active_requests", "You already have too many active song requests.");
    }
  }

  async removeQueuedTrack(trackId, triggeredBy) {
    const trackIndex = this.queue.findIndex((track) => track.id === trackId);

    if (trackIndex < 0) {
      logWarn("Requested queued-track removal for an unknown track", {
        triggeredBy,
        trackId
      });
      return null;
    }

    const [removedTrack] = this.queue.splice(trackIndex, 1);
    this.clearOwnedRequestRecheck(removedTrack.id);
    this.recordAdminEvent("queue_remove", {
      triggeredBy,
      track: removedTrack
    });
    logInfo("Removed queued track", {
      triggeredBy,
      track: formatTrack(removedTrack),
      remainingQueue: this.queue.length
    });
    await this.persistRuntimeState();
    this.broadcastState();
    return this.serializeTrack(removedTrack);
  }

  async moveQueuedTrack(trackId, offset, triggeredBy) {
    const trackIndex = this.queue.findIndex((track) => track.id === trackId);

    if (trackIndex < 0) {
      logWarn("Requested queued-track move for an unknown track", {
        triggeredBy,
        trackId,
        offset
      });
      return null;
    }

    const normalizedOffset = Number.isInteger(offset)
      ? offset
      : Number.parseInt(String(offset ?? 0), 10) || 0;
    const nextIndex = Math.max(0, Math.min(this.queue.length - 1, trackIndex + normalizedOffset));
    const [trackToMove] = this.queue.splice(trackIndex, 1);
    this.queue.splice(nextIndex, 0, trackToMove);
    this.recordAdminEvent("queue_move", {
      triggeredBy,
      track: trackToMove,
      details: {
        fromIndex: trackIndex + 1,
        toIndex: nextIndex + 1
      }
    });

    logInfo("Moved queued track", {
      triggeredBy,
      track: formatTrack(trackToMove),
      fromIndex: trackIndex,
      toIndex: nextIndex,
      queueLength: this.queue.length
    });
    await this.persistRuntimeState();
    this.broadcastState();
    return this.serializeTrack(trackToMove);
  }

  async promoteQueuedTrack(trackId, triggeredBy) {
    const trackIndex = this.queue.findIndex((track) => track.id === trackId);

    if (trackIndex < 0) {
      logWarn("Requested queued-track promotion for an unknown track", {
        triggeredBy,
        trackId
      });
      return null;
    }

    const [trackToPromote] = this.queue.splice(trackIndex, 1);
    this.queue.unshift(trackToPromote);
    this.recordAdminEvent("queue_promote", {
      triggeredBy,
      track: trackToPromote
    });
    logInfo("Promoted queued track", {
      triggeredBy,
      track: formatTrack(trackToPromote),
      queueLength: this.queue.length
    });
    await this.persistRuntimeState();
    this.broadcastState();
    return this.serializeTrack(trackToPromote);
  }

  async clearQueue(triggeredBy) {
    const clearedTracks = [
      ...this.queue,
      ...this.radioQueue
    ].map((track) => this.serializeTrack(track));
    for (const track of this.queue) {
      this.clearOwnedRequestRecheck(track.id);
    }
    this.queue = [];
    this.radioQueue = [];
    this.recordAdminEvent("queue_clear", {
      triggeredBy,
      details: {
        clearedCount: clearedTracks.length
      }
    });
    logInfo("Cleared queue", {
      triggeredBy,
      clearedCount: clearedTracks.length
    });
    await this.persistRuntimeState();
    this.broadcastState();
    return {
      clearedCount: clearedTracks.length,
      clearedTracks
    };
  }

  getQueueSummary(limit = 3) {
    return this.getUpcomingTracks()
      .slice(0, Math.max(1, limit))
      .map((track) => this.serializeTrack(track));
  }

  getQueuePositionForRequester(username) {
    const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
    if (!normalizedUsername) {
      return null;
    }

    const queueIndex = this.queue.findIndex((track) =>
      track.requestedBy?.username?.trim().toLowerCase() === normalizedUsername
    );

    if (queueIndex < 0) {
      return null;
    }

    return {
      position: queueIndex + 1,
      track: this.serializeTrack(this.queue[queueIndex])
    };
  }

  async removeQueuedTrackByRequester(username, triggeredBy) {
    const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
    if (!normalizedUsername) {
      return null;
    }

    const trackIndex = this.queue.findIndex((track) =>
      track.requestedBy?.username?.trim().toLowerCase() === normalizedUsername
    );

    if (trackIndex < 0) {
      logWarn("Requested own queued-track removal but nothing matched the requester", {
        triggeredBy,
        username: normalizedUsername
      });
      return null;
    }

    const [removedTrack] = this.queue.splice(trackIndex, 1);
    this.clearOwnedRequestRecheck(removedTrack.id);
    this.recordAdminEvent("queue_remove_own", {
      triggeredBy,
      track: removedTrack
    });
    logInfo("Removed queued track by requester", {
      triggeredBy,
      username: normalizedUsername,
      track: formatTrack(removedTrack),
      remainingQueue: this.queue.length
    });
    await this.persistRuntimeState();
    this.broadcastState();
    return this.serializeTrack(removedTrack);
  }

  findDuplicateTrack(trackKey) {
    if (!trackKey) {
      return null;
    }

    if (this.currentTrack?.key === trackKey) {
      return {
        track: this.currentTrack,
        type: "playing"
      };
    }

    const queuedTrack = [
      ...this.queue,
      ...this.radioQueue
    ].find((queuedTrack) => queuedTrack.key === trackKey);

    if (!queuedTrack) {
      if (this.stoppedTrack?.key === trackKey) {
        return {
          track: this.stoppedTrack,
          type: "stopped"
        };
      }

      const duplicateHistoryCount = Number.isInteger(this.requestPolicy.duplicateHistoryCount)
        ? this.requestPolicy.duplicateHistoryCount
        : 0;
      if (duplicateHistoryCount > 0) {
        const historyMatch = this.history
          .slice(0, duplicateHistoryCount)
          .find((entry) => entry?.track?.key === trackKey);

        if (historyMatch?.track) {
          return {
            track: historyMatch.track,
            type: "history"
          };
        }
      }

      return null;
    }

    return {
      track: queuedTrack,
      type: "queue"
    };
  }

  onTrackStart(listener) {
    this.trackStartListeners.add(listener);

    return () => {
      this.trackStartListeners.delete(listener);
    };
  }

  onTrackPlayback(listener) {
    this.trackPlaybackListeners.add(listener);

    return () => {
      this.trackPlaybackListeners.delete(listener);
    };
  }

  onTrackFinish(listener) {
    this.trackFinishListeners.add(listener);

    return () => {
      this.trackFinishListeners.delete(listener);
    };
  }

  onPlaybackIdle(listener) {
    this.playbackIdleListeners.add(listener);

    return () => {
      this.playbackIdleListeners.delete(listener);
    };
  }

  notifyPlaybackIdle(payload) {
    let rearmClaimed = false;
    for (const listener of this.playbackIdleListeners) {
      try {
        const listenerResult = listener(payload);
        rearmClaimed ||= listenerResult === true;
        Promise.resolve(listenerResult).catch((error) => {
          logWarn("Playback-idle listener failed", {
            message: error?.message ?? String(error)
          });
        });
      } catch (error) {
        logWarn("Playback-idle listener failed", {
          message: error?.message ?? String(error)
        });
      }
    }
    return rearmClaimed;
  }

  async skipCurrentTrack(triggeredBy) {
    if (!this.currentTrack) {
      logWarn("Skip requested but nothing is currently playing", {
        triggeredBy
      });
      return null;
    }

    const skippedTrack = this.currentTrack;
    this.recordAdminEvent("skip_current", {
      triggeredBy,
      track: skippedTrack
    });

    logInfo("Skipping current track", {
      triggeredBy,
      track: formatTrack(skippedTrack)
    });

    this.io.emit("player:stop", {
      reason: "skip",
      triggeredBy
    });

    await this.finishCurrentTrack({
      status: "skipped",
      trackId: skippedTrack.id,
      suppressEnsurePlayback: true
    });

    return skippedTrack;
  }

  async skipToNextTrack(triggeredBy) {
    if (this.currentTrack) {
      const skippedTrack = await this.skipCurrentTrack(triggeredBy);

      if (skippedTrack) {
        this.stoppedTrack = null;
        await this.ensurePlayback();
      }

      return skippedTrack;
    }

    if (this.stoppedTrack) {
      const skippedTrack = this.stoppedTrack;
      this.stoppedTrack = null;
      this.isPlaybackPaused = false;

      logInfo("Skipping stopped track and advancing playback", {
        triggeredBy,
        track: formatTrack(skippedTrack)
      });

      this.broadcastState();
      await this.ensurePlayback();
      return skippedTrack;
    }

    logWarn("Next track requested but nothing is currently available", {
      triggeredBy
    });
    await this.ensurePlayback();
    return this.currentTrack;
  }

  async deleteCurrentTrack(triggeredBy) {
    if (!this.currentTrack) {
      logWarn("Delete requested but nothing is currently playing", {
        triggeredBy
      });
      return null;
    }

    const trackToDelete = this.currentTrack;
    this.recordAdminEvent("delete_current", {
      triggeredBy,
      track: trackToDelete
    });

    logInfo("Deleting current track", {
      triggeredBy,
      track: formatTrack(trackToDelete)
    });

    await this.playlistRepository.removeTrack(trackToDelete);

    this.io.emit("player:stop", {
      reason: "delete",
      triggeredBy
    });

    await this.finishCurrentTrack({
      status: "deleted",
      trackId: trackToDelete.id,
      suppressEnsurePlayback: true
    });

    return trackToDelete;
  }

  async saveCurrentTrack(triggeredBy) {
    if (!this.currentTrack) {
      logWarn("Save requested but nothing is currently playing", {
        triggeredBy
      });
      return null;
    }

    const saved = await this.playlistRepository.appendTrack(this.currentTrack);
    const track = this.currentTrack;

    logInfo("Saving current track", {
      triggeredBy,
      saved,
      track: formatTrack(track)
    });

    this.recordAdminEvent("save_current", {
      triggeredBy,
      track,
      details: {
        alreadySaved: !saved
      }
    });
    await this.persistRuntimeState();
    this.broadcastState();

    return {
      saved,
      alreadySaved: !saved,
      track: this.serializeTrack(track)
    };
  }

  async appendTracksToPlaylist(tracks, {
    triggeredBy = "unknown",
    details = null
  } = {}) {
    const result = await this.playlistRepository.appendTracks(tracks);

    logInfo("Appending tracks to playlist", {
      triggeredBy,
      addedCount: result.addedCount,
      duplicateCount: result.duplicateCount
    });

    this.recordAdminEvent("playlist_import", {
      triggeredBy,
      details: {
        addedCount: result.addedCount,
        duplicateCount: result.duplicateCount,
        ...(details && typeof details === "object" ? details : {})
      }
    });
    await this.persistRuntimeState();
    this.broadcastState();

    return result;
  }

  getCurrentTrack() {
    return this.serializeTrack(this.currentTrack);
  }

  isPlaybackAdvancePending() {
    return this.isAdvancing;
  }

  async restoreRuntimeState() {
    if (!this.runtimeStateStore) {
      if (!this.requestAuditStore) {
        return;
      }
    }

    if (this.runtimeStateStore) {
      const persistedState = await this.runtimeStateStore.load();
      this.queue = Array.isArray(persistedState.queue)
        ? persistedState.queue.map((track) => ({ ...track }))
        : [];
      for (const track of this.queue) {
        if (["youtube", "suno", "soundcloud"].includes(track.provider)) {
          this.scheduleOwnedRequestRecheck(track);
        }
      }
      this.radioQueue = Array.isArray(persistedState.radioQueue)
        ? persistedState.radioQueue.map((track) => ({ ...track }))
        : [];
      if (!this.radioModeEnabled) {
        this.radioQueue = [];
      } else if (this.radioQueue.length > this.radioTrackCount) {
        this.radioQueue = this.radioQueue.slice(0, this.radioTrackCount);
      }
      this.stoppedTrack = persistedState.stoppedTrack
        ? { ...persistedState.stoppedTrack }
        : null;
      this.history = Array.isArray(persistedState.history)
        ? persistedState.history.slice(0, this.historyLimit).map((entry) => ({
            track: { ...entry.track },
            status: entry.status,
            completedAt: entry.completedAt
          }))
        : [];
      this.adminEvents = Array.isArray(persistedState.adminEvents)
        ? persistedState.adminEvents.slice(0, 50).map((entry) => ({
            action: entry.action,
            triggeredBy: entry.triggeredBy,
            track: entry.track ? { ...entry.track } : null,
            details: entry.details ?? null,
            createdAt: entry.createdAt
          }))
        : [];
    }

    if (this.requestAuditStore) {
      const persistedAudit = await this.requestAuditStore.load();
      this.requestEvents = Array.isArray(persistedAudit.events)
        ? persistedAudit.events.slice(0, this.requestAuditLimit).map((entry) => ({
            ...entry,
            requester: entry.requester ? { ...entry.requester } : null,
            track: entry.track ? { ...entry.track } : null,
            queueState: entry.queueState ? { ...entry.queueState } : null,
            requesterStats: entry.requesterStats ? { ...entry.requesterStats } : null,
            details: entry.details ?? null
          }))
        : [];
      this.requesterStatsByUser = new Map(
        Object.entries(persistedAudit.requesterStats ?? {}).map(([key, value]) => [
          key,
          {
            ...value,
            requester: value.requester ? { ...value.requester } : null
          }
        ])
      );
    }

    logInfo("Restored runtime playback state", {
      queueLength: this.queue.length,
      radioQueueLength: this.radioQueue.length,
      hasStoppedTrack: Boolean(this.stoppedTrack),
      historyLength: this.history.length,
      adminEventCount: this.adminEvents.length,
      requestEventCount: this.requestEvents.length,
      requesterStatCount: this.requesterStatsByUser.size
    });
  }

  async setPlaybackSuppressed(isSuppressed, { category = "" } = {}) {
    const nextSuppressed = Boolean(isSuppressed);
    const nextCategory = nextSuppressed ? category : "";

    if (
      this.playbackSuppressed === nextSuppressed &&
      this.playbackSuppressedCategory === nextCategory
    ) {
      return;
    }

    this.playbackSuppressed = nextSuppressed;
    this.playbackSuppressedCategory = nextCategory;
    if (nextSuppressed) {
      logInfo("Playback suppressed by Twitch category", {
        category: nextCategory || null,
        currentTrack: formatTrack(this.currentTrack)
      });

      if (this.currentTrack) {
        const interruptedTrack = {
          ...this.currentTrack,
          elapsedSeconds: 0
        };

        if (interruptedTrack.origin === "queue") {
          delete interruptedTrack.playbackConfirmed;
          this.queue.unshift(interruptedTrack);
        } else if (interruptedTrack.origin === "radio") {
          delete interruptedTrack.playbackConfirmed;
          this.radioQueue.unshift(interruptedTrack);
        }

        this.io.emit("player:stop", {
          reason: "category_suppressed",
          category: nextCategory || null
        });
        await this.externalPlayback?.stopTrack?.(interruptedTrack, {
          reason: "category_suppressed"
        });

        this.isPlaybackPaused = false;
        this.currentTrack = null;
        this.resetCurrentTrackProgress();
        await this.persistRuntimeState();
        this.broadcastState();
      }

      return;
    }

    logInfo("Playback suppression cleared", {
      category: this.playbackSuppressedCategory || null
    });
    await this.ensurePlayback();
  }

  async handlePlayerEvent(payload) {
    if (!payload?.trackId || payload.trackId !== this.currentTrack?.id) {
      logWarn("Ignoring player event for unknown track", payload ?? {});
      return;
    }

    if (!["playing", "ended", "error", "deleted"].includes(payload.status)) {
      logWarn("Ignoring unsupported player event status", payload ?? {});
      return;
    }

    logInfo("Received player event", payload);

    const durationUpdated = this.updateCurrentTrackDurationSeconds(payload.durationSeconds);

    if (payload.status === "playing") {
      await this.confirmCurrentTrackPlayback(payload, { durationUpdated });
      return;
    }

    if (
      payload.status === "error" &&
      await this.tryStartExternalPlayback({
        reason: payload.reason || "player_error",
        playerErrorPayload: payload
      })
    ) {
      return;
    }

    await this.finishCurrentTrack(payload);
  }

  updateCurrentTrackDurationSeconds(durationSeconds) {
    if (!this.currentTrack) {
      return false;
    }

    const nextDurationSeconds = normalizeDurationSeconds(durationSeconds);
    if (nextDurationSeconds === null) {
      return false;
    }

    const currentDurationSeconds = normalizeDurationSeconds(this.currentTrack.durationSeconds);
    if (currentDurationSeconds === nextDurationSeconds) {
      return false;
    }

    this.currentTrack.durationSeconds = nextDurationSeconds;
    this.currentTrackElapsedSeconds = this.clampElapsedSeconds(
      this.currentTrack,
      this.currentTrackElapsedSeconds
    );
    this.currentTrack.elapsedSeconds = this.currentTrackElapsedSeconds;

    logInfo("Updated current track duration from player metadata", {
      track: formatTrack(this.currentTrack),
      durationSeconds: nextDurationSeconds
    });

    if (this.currentTrack.playbackConfirmed) {
      this.scheduleFallbackPlaylistFinishTimer();
    }

    return true;
  }

  async confirmCurrentTrackPlayback(payload, { durationUpdated = false } = {}) {
    if (!this.currentTrack || this.currentTrack.id !== payload.trackId) {
      return;
    }

    if (this.currentTrack.playbackConfirmed) {
      if (durationUpdated) {
        this.scheduleFallbackPlaylistFinishTimer();
        this.broadcastState();
      }
      return;
    }

    this.currentTrack.playbackConfirmed = true;
    this.currentTrackElapsedSeconds = this.clampElapsedSeconds(
      this.currentTrack,
      this.currentTrack.elapsedSeconds
    );
    this.currentTrack.elapsedSeconds = this.currentTrackElapsedSeconds;
    this.currentTrackStartedAt = this.isPlaybackPaused ? 0 : Date.now();

    logInfo("Playback confirmed for current track", {
      track: formatTrack(this.currentTrack)
    });

    this.scheduleFallbackPlaylistFinishTimer();

    await this.playlistRepository.recordTrackPlaybackSuccess?.(this.currentTrack);

    for (const listener of this.trackPlaybackListeners) {
      try {
        await listener(this.currentTrack);
      } catch (error) {
        logWarn("Track playback listener failed", {
          message: error?.message ?? String(error)
        });
      }
    }

    this.broadcastState();
  }

  async finishCurrentTrack(payload) {
    const activeTrack = this.currentTrack;

    if (!activeTrack || activeTrack.id !== payload.trackId) {
      return;
    }

    this.clearFallbackPlaylistFinishTimer();

    const finishedTrack = {
      ...activeTrack,
      elapsedSeconds: this.captureCurrentTrackElapsedSeconds()
    };

    delete finishedTrack.playbackConfirmed;

    logInfo("Finishing current track", {
      status: payload.status,
      track: formatTrack(finishedTrack)
    });

    this.currentTrack = null;
    this.isPlaybackPaused = false;
    this.resetCurrentTrackProgress();
    this.pushHistoryEntry(finishedTrack, payload.status);
    await this.persistRuntimeState();
    this.broadcastState();
    await this.externalPlayback?.stopTrack?.(finishedTrack, {
      reason: payload.reason || payload.status
    });

    if (
      payload.status === "ended" &&
      (finishedTrack.origin === "queue" || finishedTrack.origin === "radio")
    ) {
      await this.playlistRepository.appendTrack(finishedTrack);
    }

    if (payload.status === "error") {
      await this.playlistRepository.recordTrackPlaybackFailure?.(finishedTrack, {
        reason: payload.reason || "playback_error",
        message: payload.message || "",
        source: "player"
      });
    }

    for (const listener of this.trackFinishListeners) {
      try {
        await listener({
          track: finishedTrack,
          status: payload.status,
          reason: payload.reason || "",
          message: payload.message || "",
          triggeredBy: payload.triggeredBy || ""
        });
      } catch (error) {
        logWarn("Track finish listener failed", {
          message: error?.message ?? String(error)
        });
      }
    }

    if (finishedTrack.origin === "queue" && this.queue.length === 0) {
      await this.rebuildRadioQueue(finishedTrack);
    }

    if (!payload.suppressEnsurePlayback) {
      await this.ensurePlayback();
    }

    return finishedTrack;
  }

  async ensurePlayback() {
    if (this.currentTrack || this.isAdvancing) {
      if (this.currentTrack) {
        logInfo("Playback already active", {
          track: formatTrack(this.currentTrack)
        });
      }
      return;
    }

    if (this.playbackSuppressed) {
      logInfo("Playback suppressed; not starting a track", {
        category: this.playbackSuppressedCategory || null,
        queueLength: this.queue.length
      });
      return;
    }

    if (this.stoppedTrack) {
      logInfo("Playback is manually stopped; not auto-starting a track", {
        stoppedTrack: formatTrack(this.stoppedTrack),
        queueLength: this.queue.length
      });
      return;
    }

    this.isAdvancing = true;

    try {
      let nextTrack = null;
      let source = "playlist";

      while (this.queue.length > 0 && !nextTrack) {
        const queuedTrack = this.queue[0];
        let routed = null;
        try {
          routed = await this.checkOwnedRequest(queuedTrack);
        } catch (error) {
          logWarn("Final AutoDJ ownership check is temporarily unavailable", {
            track: formatTrack(queuedTrack),
            message: error?.message ?? String(error)
          });
        }
        if (routed?.matched === true && this.queue[0]?.id === queuedTrack.id) {
          this.queue.shift();
          this.clearOwnedRequestRecheck(queuedTrack.id);
          await this.persistRuntimeState();
          this.broadcastState();
          continue;
        }
        nextTrack = queuedTrack;
        source = "queue";
      }

      if (!nextTrack && this.radioQueue.length > 0) {
        nextTrack = this.radioQueue[0];
        source = "radio";
      }
      if (!nextTrack) {
        nextTrack = await this.playlistRepository.getRandomTrack();
      }

      if (!nextTrack) {
        logWarn("No track available for playback", {
          queueLength: this.queue.length
        });
        await this.persistRuntimeState();
        this.broadcastState();
        return;
      }

      if (this.beforeTrackStart) {
        try {
          const readiness = await this.beforeTrackStart(nextTrack);
          if (readiness === false || readiness?.ready === false) {
            throw new Error(readiness?.error || "AutoDJ takeover was not acknowledged.");
          }
        } catch (error) {
          logWarn("Holding online playback until AutoDJ takeover is acknowledged", {
            track: formatTrack(nextTrack),
            message: error?.message ?? String(error)
          });
          this.broadcastState();
          return;
        }
      }

      if (source === "queue" && this.queue[0]?.id === nextTrack.id) {
        this.queue.shift();
        this.clearOwnedRequestRecheck(nextTrack.id);
      } else if (source === "radio" && this.radioQueue[0]?.id === nextTrack.id) {
        this.radioQueue.shift();
      }

      await this.startTrackPlayback(nextTrack, {
        notifyTrackStartListeners: true
      });
    } finally {
      this.isAdvancing = false;
    }
  }

  async startTrackPlayback(track, { notifyTrackStartListeners = false } = {}) {
    this.stoppedTrack = null;
    this.currentTrack = {
      ...track,
      id: track.id ?? crypto.randomUUID(),
      elapsedSeconds: 0,
      playbackConfirmed: false
    };
    this.isPlaybackPaused = false;
    this.resetCurrentTrackProgress();

    logInfo("Starting playback", {
      track: formatTrack(this.currentTrack),
      remainingQueue: this.queue.length
    });

    if (notifyTrackStartListeners) {
      for (const listener of this.trackStartListeners) {
        try {
          await listener(this.currentTrack);
        } catch (error) {
          logWarn("Track start listener failed", {
            message: error?.message ?? String(error)
          });
        }
      }
    }

    await this.persistRuntimeState();

    if (
      await this.tryStartExternalPlayback({
        reason: this.currentTrack?.isEmbeddable === false
          ? "metadata_embed_blocked"
          : "track_start"
      })
    ) {
      return;
    }

    await this.clearExternalPlaybackSource({
      reason: "embedded_playback_start"
    });
    this.broadcastState();
    this.io.emit("player:load", {
      track: this.serializeTrack(this.currentTrack)
    });
  }

  async tryStartExternalPlayback({ reason = "", playerErrorPayload = null } = {}) {
    if (!this.currentTrack || !this.externalPlayback) {
      return false;
    }

    const shouldHandle = playerErrorPayload
      ? this.externalPlayback.shouldHandlePlayerError?.(this.currentTrack, playerErrorPayload)
      : this.externalPlayback.shouldHandleTrack?.(this.currentTrack);

    if (!shouldHandle) {
      return false;
    }

    try {
      this.io.emit("player:stop", {
        reason: "obs_youtube_fallback",
        trackId: this.currentTrack.id
      });
      const externalPlaybackResult = await this.externalPlayback.startTrack(this.currentTrack, {
        reason
      });
      if (externalPlaybackResult?.unavailable) {
        const failedTrackId = this.currentTrack.id;
        const failureReason = externalPlaybackResult.reason || "external_playback_unavailable";
        const failureMessage = externalPlaybackResult.message || "The external playback track is unavailable.";
        logWarn("Skipping unavailable external playback track", {
          track: formatTrack(this.currentTrack),
          reason: failureReason,
          message: failureMessage
        });
        const failureTimer = setTimeout(() => {
          void this.handlePlayerEvent({
            trackId: failedTrackId,
            status: "error",
            reason: failureReason,
            message: failureMessage
          }).catch((error) => {
            logWarn("Failed to advance unavailable external playback track", {
              trackId: failedTrackId,
              reason: failureReason,
              message: error?.message ?? String(error)
            });
          });
        }, 0);
        failureTimer.unref?.();
        return true;
      }

      this.updateCurrentTrackDurationSeconds(externalPlaybackResult?.durationSeconds);
      await this.confirmCurrentTrackPlayback({
        trackId: this.currentTrack.id,
        status: "playing",
        durationSeconds: this.currentTrack.durationSeconds
      });
      return true;
    } catch (error) {
      logWarn("Failed to start OBS YouTube fallback playback", {
        track: formatTrack(this.currentTrack),
        reason,
        message: error?.message ?? String(error)
      });
      return false;
    }
  }

  async clearExternalPlaybackSource({ reason = "" } = {}) {
    if (!this.externalPlayback?.clearSource) {
      return true;
    }

    try {
      return await this.externalPlayback.clearSource({
        reason,
        track: this.currentTrack
      });
    } catch (error) {
      logWarn("Failed to clear external playback source", {
        track: formatTrack(this.currentTrack),
        reason,
        message: error?.message ?? String(error)
      });
      return false;
    }
  }

  isExternalPlaybackActiveForTrack(track) {
    if (!track || !this.externalPlayback) {
      return false;
    }

    return Boolean(
      this.externalPlayback.isPlayingTrack?.(track) ||
      this.externalPlayback.shouldHandleTrack?.(track)
    );
  }

  broadcastState() {
    logInfo("Broadcasting state", {
      currentTrack: formatTrack(this.currentTrack),
      queueLength: this.queue.length
    });
    this.io.emit("state", this.getBroadcastState());
  }

  async togglePauseCurrentTrack(triggeredBy) {
    if (!this.currentTrack) {
      logWarn("Pause toggle requested but nothing is currently playing", {
        triggeredBy
      });
      return null;
    }

    if (this.isPlaybackPaused) {
      this.isPlaybackPaused = false;
      this.currentTrackStartedAt = Date.now();
      this.scheduleFallbackPlaylistFinishTimer();
    } else {
      this.captureCurrentTrackElapsedSeconds();
      this.isPlaybackPaused = true;
      this.clearFallbackPlaylistFinishTimer();
    }

    logInfo("Toggling playback pause state", {
      triggeredBy,
      paused: this.isPlaybackPaused,
      track: formatTrack(this.currentTrack)
    });

    this.io.emit("player:toggle-pause", {
      trackId: this.currentTrack.id,
      paused: this.isPlaybackPaused,
      triggeredBy
    });
    this.broadcastState();

    return {
      track: this.serializeTrack(this.currentTrack),
      paused: this.isPlaybackPaused
    };
  }

  async playOrPausePlayback(triggeredBy) {
    if (this.currentTrack) {
      return this.togglePauseCurrentTrack(triggeredBy);
    }

    if (this.stoppedTrack) {
      logInfo("Resuming stopped track from the beginning", {
        triggeredBy,
        track: formatTrack(this.stoppedTrack)
      });
      this.recordAdminEvent("restart_stopped", {
        triggeredBy,
        track: this.stoppedTrack
      });
      await this.startTrackPlayback(this.stoppedTrack, {
        notifyTrackStartListeners: false
      });

      return {
        track: this.serializeTrack(this.currentTrack),
        paused: false,
        resumedFromStopped: true
      };
    }

    logInfo("Starting playback from idle state", {
      triggeredBy,
      queueLength: this.queue.length
    });
    await this.ensurePlayback();

    return {
      track: this.serializeTrack(this.currentTrack),
      paused: false,
      resumedFromStopped: false
    };
  }

  async stopPlayback(triggeredBy) {
    if (this.currentTrack) {
      const stoppedTrack = {
        ...this.currentTrack,
        elapsedSeconds: this.captureCurrentTrackElapsedSeconds()
      };

      delete stoppedTrack.playbackConfirmed;

      logInfo("Stopping playback without advancing", {
        triggeredBy,
        track: formatTrack(stoppedTrack)
      });

      this.stoppedTrack = stoppedTrack;
      this.recordAdminEvent("stop_playback", {
        triggeredBy,
        track: stoppedTrack
      });
      this.io.emit("player:stop", {
        reason: "manual_stop",
        triggeredBy
      });
      await this.externalPlayback?.stopTrack?.(stoppedTrack, {
        reason: "manual_stop"
      });
      this.currentTrack = null;
      this.isPlaybackPaused = false;
      this.resetCurrentTrackProgress();
      this.pushHistoryEntry(stoppedTrack, "stopped");
      await this.persistRuntimeState();
      this.broadcastState();

      return this.serializeTrack(this.stoppedTrack);
    }

    if (this.stoppedTrack) {
      logInfo("Stop requested while playback is already stopped", {
        triggeredBy,
        track: formatTrack(this.stoppedTrack)
      });
      return this.serializeTrack(this.stoppedTrack);
    }

    logWarn("Stop requested but no track is available", {
      triggeredBy
    });
    return null;
  }

  pushHistoryEntry(track, status) {
    if (!track) {
      return;
    }

    this.history.unshift({
      track: {
        id: track.id,
        provider: track.provider,
        url: track.url,
        title: track.title,
        artist: track.artist ?? "",
        trackTitle: track.trackTitle ?? "",
        key: track.key,
        origin: track.origin,
        artworkUrl: track.artworkUrl ?? "",
        audioUrl: track.audioUrl ?? "",
        soundCloudResourceUrl: track.soundCloudResourceUrl ?? "",
        durationSeconds: Number.isFinite(track.durationSeconds) ? track.durationSeconds : null,
        elapsedSeconds: this.clampElapsedSeconds(track, track.elapsedSeconds),
        requestedFromProvider: track.requestedFromProvider ?? "",
        requestedFromUrl: track.requestedFromUrl ?? "",
        requestedFromTitle: track.requestedFromTitle ?? "",
        requestedFromName: track.requestedFromName ?? "",
        requestedFromKey: track.requestedFromKey ?? "",
        requestedBy: track.requestedBy ?? null
      },
      status,
      completedAt: new Date().toISOString()
    });

    if (this.history.length > this.historyLimit) {
      this.history.length = this.historyLimit;
    }
  }

  async persistRuntimeState() {
    if (!this.runtimeStateStore) {
      await this.persistRequestAuditState();
      return;
    }

    await this.runtimeStateStore.save({
      queue: this.queue,
      radioQueue: this.radioQueue,
      stoppedTrack: this.stoppedTrack,
      history: this.history,
      adminEvents: this.adminEvents
    });
    await this.persistRequestAuditState();
  }

  async persistRequestAuditState() {
    if (!this.requestAuditStore) {
      return;
    }

    await this.requestAuditStore.save({
      events: this.requestEvents,
      requesterStats: Object.fromEntries(this.requesterStatsByUser.entries())
    });
  }

  getUpcomingTracks() {
    return [
      ...this.queue,
      ...this.radioQueue
    ];
  }

  collectRadioExcludedTrackKeys(seedTrack = null) {
    const excludedTrackKeys = new Set();

    [
      seedTrack,
      this.currentTrack,
      this.stoppedTrack,
      ...this.queue,
      ...this.radioQueue,
      ...this.history.map((entry) => entry?.track).filter(Boolean)
    ].forEach((track) => {
      if (typeof track?.key === "string" && track.key.trim()) {
        excludedTrackKeys.add(track.key.trim());
      }
    });

    return Array.from(excludedTrackKeys);
  }

  collectRadioExcludedTracks(seedTrack = null) {
    return [
      seedTrack,
      this.currentTrack,
      this.stoppedTrack,
      ...this.queue,
      ...this.radioQueue,
      ...this.history.map((entry) => entry?.track).filter(Boolean)
    ].filter(Boolean);
  }

  async rebuildRadioQueue(seedTrack) {
    this.radioQueue = [];

    if (!this.radioModeEnabled || !this.getRadioTracks || !seedTrack) {
      await this.persistRuntimeState();
      this.broadcastState();
      return;
    }

    let radioTracks = [];

    try {
      radioTracks = await this.getRadioTracks({
        count: this.radioTrackCount,
        seedTrack: {
          ...seedTrack
        },
        excludeTrackKeys: this.collectRadioExcludedTrackKeys(seedTrack),
        excludeTracks: this.collectRadioExcludedTracks(seedTrack)
      });
    } catch (error) {
      logWarn("Failed to build radio queue", {
        seedTrack: formatTrack(seedTrack),
        message: error?.message ?? String(error)
      });
    }

    if (Array.isArray(radioTracks)) {
      const excludedTracks = this.collectRadioExcludedTracks(seedTrack);

      for (const radioTrack of radioTracks) {
        if (!radioTrack?.key || this.playlistRepository.hasTrack(radioTrack) || this.findDuplicateTrack(radioTrack.key)) {
          continue;
        }

        if (
          Number.isFinite(radioTrack.durationSeconds) &&
          radioTrack.durationSeconds > MAX_RADIO_TRACK_DURATION_SECONDS
        ) {
          continue;
        }

        if (excludedTracks.some((track) => tracksShareIdentity(track, radioTrack, {
          titleOnly: true
        }) || trackTitlesOverlap(track, radioTrack))) {
          continue;
        }

        this.radioQueue.push({
          ...radioTrack,
          id: crypto.randomUUID(),
          origin: "radio",
          requestedBy: null
        });
        excludedTracks.push(radioTrack);

        if (this.radioQueue.length >= this.radioTrackCount) {
          break;
        }
      }
    }

    if (this.radioQueue.length > 0) {
      logInfo("Queued automatic radio tracks", {
        seedTrack: formatTrack(seedTrack),
        addedCount: this.radioQueue.length
      });
    }

    await this.persistRuntimeState();
    this.broadcastState();
  }
}
