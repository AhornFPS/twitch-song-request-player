// @ts-nocheck
import OBSWebSocket from "obs-websocket-js";
import { formatTrack, logInfo, logWarn } from "./logger.js";

const youtubeLoginUrl = "https://www.youtube.com/";
const blankUrl = "about:blank";
const endedReason = "obs_youtube_fallback_timer";
const blockedEmbedReasons = new Set([
  "youtube_101",
  "youtube_150",
  "playback_confirmation_timeout"
]);

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeObsWebSocketUrl(value) {
  const trimmedValue = trimString(value) || "ws://127.0.0.1:4455";

  if (/^wss?:\/\//i.test(trimmedValue)) {
    return trimmedValue;
  }

  return `ws://${trimmedValue}`;
}

function addAutoplay(url) {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.searchParams.set("autoplay", "1");
    return parsedUrl.toString();
  } catch {
    return url;
  }
}

function extractVideoIdFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (hostname === "youtu.be") {
      return parsedUrl.pathname.slice(1) || "";
    }

    const searchVideoId = parsedUrl.searchParams.get("v");
    if (searchVideoId) {
      return searchVideoId;
    }

    const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
    const videoPathIndex = pathSegments.findIndex((segment) => segment === "embed" || segment === "shorts");
    return videoPathIndex === -1 ? "" : pathSegments[videoPathIndex + 1] || "";
  } catch {
    return "";
  }
}

function extractVideoIdFromTrack(track) {
  const key = typeof track?.key === "string" ? track.key.trim() : "";
  const youtubeKeyPrefix = "youtube:";

  if (key.startsWith(youtubeKeyPrefix)) {
    const keyValue = key.slice(youtubeKeyPrefix.length).trim();
    if (/^[a-z0-9_-]{6,}$/i.test(keyValue)) {
      return keyValue;
    }
  }

  const url = typeof track?.url === "string" ? track.url.trim() : "";
  return url ? extractVideoIdFromUrl(url) : "";
}

function buildPlaybackUrl(track) {
  const videoId = extractVideoIdFromTrack(track);
  if (videoId) {
    return addAutoplay(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`);
  }

  if (typeof track?.url === "string" && track.url.trim()) {
    return addAutoplay(track.url.trim());
  }

  return youtubeLoginUrl;
}

function normalizeTrackDurationSeconds(track) {
  const durationSeconds = Number(track?.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  return Math.max(1, Math.floor(durationSeconds));
}

export class ObsYoutubeFallback {
  constructor({
    getSettings,
    onTrackEnded = async () => {},
    createClient = () => new OBSWebSocket(),
    resolveTrackMetadata = null,
    playbackBufferSeconds = 1,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    sourceClearRetryDelaysMs = [1_000, 3_000, 10_000, 30_000]
  } = {}) {
    this.getSettings = typeof getSettings === "function" ? getSettings : () => ({});
    this.onTrackEnded = onTrackEnded;
    this.createClient = createClient;
    this.resolveTrackMetadata = typeof resolveTrackMetadata === "function"
      ? resolveTrackMetadata
      : null;
    this.playbackBufferSeconds = playbackBufferSeconds;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.sourceClearRetryDelaysMs = sourceClearRetryDelaysMs;
    this.activeTrackId = "";
    this.playbackGeneration = 0;
    this.desiredTrackId = "";
    this.finishTimer = null;
    // OBS persists Browser Source settings between launches. Assume the source
    // may still contain an autoplay URL until we have successfully blanked it.
    this.sourceClearNeeded = true;
    this.sourceClearPromise = null;
    this.sourceClearRetryTimer = null;
    this.sourceClearRetryAttempt = 0;
  }

  getConfig() {
    const settings = this.getSettings() ?? {};
    return {
      enabled: settings.obsYoutubeFallbackEnabled === true,
      webSocketUrl: normalizeObsWebSocketUrl(settings.obsWebSocketUrl),
      password: trimString(settings.obsWebSocketPassword),
      sourceName: trimString(settings.obsYoutubeFallbackSourceName)
    };
  }

  isConfigured() {
    const config = this.getConfig();
    return Boolean(config.enabled && config.webSocketUrl && config.sourceName);
  }

  canPlayBlockedYouTube(track) {
    return track?.provider === "youtube" && this.isConfigured();
  }

  shouldHandleTrack(track) {
    return track?.provider === "youtube" && track.isEmbeddable === false && this.isConfigured();
  }

  shouldHandlePlayerError(track, payload = {}) {
    const reason = trimString(payload.reason).toLowerCase();
    return track?.provider === "youtube" && blockedEmbedReasons.has(reason) && this.isConfigured();
  }

  isPlayingTrack(track) {
    return Boolean(this.activeTrackId && track?.id === this.activeTrackId);
  }

  needsSourceClear() {
    return this.isConfigured() && this.sourceClearNeeded;
  }

  getStatus() {
    const config = this.getConfig();
    return {
      enabled: config.enabled,
      configured: this.isConfigured(),
      webSocketUrl: config.webSocketUrl,
      sourceName: config.sourceName,
      activeTrackId: this.activeTrackId
    };
  }

  async setSourceUrl(url, { generation = null } = {}) {
    const previous = this.sourceWritePromise ?? Promise.resolve();
    const write = previous.catch(() => {}).then(() => {
      if (generation !== null && generation !== this.playbackGeneration) return;
      return this.writeSourceUrl(url);
    });
    this.sourceWritePromise = write;
    try {
      return await write;
    } finally {
      if (this.sourceWritePromise === write) this.sourceWritePromise = null;
    }
  }

  async writeSourceUrl(url) {
    const config = this.getConfig();

    if (!config.enabled) {
      throw new Error("OBS YouTube fallback is not enabled.");
    }

    if (!config.sourceName) {
      throw new Error("Enter the OBS Browser Source name for the YouTube fallback.");
    }

    const client = this.createClient();
    await client.connect(config.webSocketUrl, config.password || undefined);

    try {
      await client.call("SetInputSettings", {
        inputName: config.sourceName,
        inputSettings: {
          url
        },
        overlay: true
      });
    } finally {
      await client.disconnect();
    }
  }

  clearFinishTimer() {
    if (!this.finishTimer) {
      return;
    }

    clearTimeout(this.finishTimer);
    this.finishTimer = null;
  }

  clearSourceClearRetryTimer() {
    if (!this.sourceClearRetryTimer) {
      return;
    }

    this.clearTimeoutFn(this.sourceClearRetryTimer);
    this.sourceClearRetryTimer = null;
  }

  scheduleSourceClearRetry({ reason = "", track = null } = {}) {
    if (this.sourceClearRetryTimer || !this.needsSourceClear()) {
      return;
    }

    const retryDelays = Array.isArray(this.sourceClearRetryDelaysMs) && this.sourceClearRetryDelaysMs.length > 0
      ? this.sourceClearRetryDelaysMs
      : [30_000];
    const retryDelayMs = retryDelays[Math.min(this.sourceClearRetryAttempt, retryDelays.length - 1)];
    this.sourceClearRetryAttempt += 1;
    this.sourceClearRetryTimer = this.setTimeoutFn(() => {
      this.sourceClearRetryTimer = null;
      void this.clearSource({
        reason: reason ? `${reason}_retry` : "source_clear_retry",
        track
      });
    }, retryDelayMs);
    this.sourceClearRetryTimer?.unref?.();
  }

  scheduleFinish(track) {
    this.clearFinishTimer();
    const durationSeconds = normalizeTrackDurationSeconds(track);
    if (durationSeconds === null) {
      logWarn("OBS YouTube fallback started without track duration; manual skip will be needed", {
        track: formatTrack(track)
      });
      return;
    }

    const trackId = track.id;
    this.finishTimer = setTimeout(() => {
      this.finishTimer = null;

      if (!this.activeTrackId || this.activeTrackId !== trackId) {
        return;
      }

      void this.onTrackEnded({
        trackId,
        reason: endedReason
      }).catch((error) => {
        logWarn("Failed to finish OBS YouTube fallback track", {
          track: formatTrack(track),
          message: error?.message ?? String(error)
        });
      });
    }, (durationSeconds + this.playbackBufferSeconds) * 1000);
  }

  async refreshMissingTrackDuration(track) {
    if (normalizeTrackDurationSeconds(track) !== null || !this.resolveTrackMetadata) {
      return null;
    }

    try {
      const refreshedTrack = await this.resolveTrackMetadata(track);
      const durationSeconds = normalizeTrackDurationSeconds(refreshedTrack);
      if (durationSeconds === null) {
        return null;
      }

      track.durationSeconds = durationSeconds;
      logInfo("Refreshed OBS YouTube fallback track duration", {
        track: formatTrack(track),
        durationSeconds
      });
      return durationSeconds;
    } catch (error) {
      if (error?.code === "youtube_video_unavailable") {
        logWarn("OBS YouTube fallback track is unavailable", {
          track: formatTrack(track),
          message: error?.message ?? String(error)
        });
        throw error;
      }

      logWarn("Failed to refresh OBS YouTube fallback track duration", {
        track: formatTrack(track),
        message: error?.message ?? String(error)
      });
      return null;
    }
  }

  async startTrack(track, { reason = "" } = {}) {
    if (this.isPlayingTrack(track)) {
      return { durationSeconds: normalizeTrackDurationSeconds(track) };
    }
    if (this.startingTrackId === track?.id && this.startingTrackPromise &&
      this.startingGeneration === this.playbackGeneration) {
      return this.startingTrackPromise;
    }
    const generation = ++this.playbackGeneration;
    this.desiredTrackId = track?.id ?? "";
    this.startingGeneration = generation;
    const promise = this.startTrackOnce(track, { reason, generation });
    this.startingTrackId = track?.id;
    this.startingTrackPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.startingTrackPromise === promise) {
        this.startingTrackPromise = null;
        this.startingTrackId = "";
      }
    }
  }

  async startTrackOnce(track, { reason = "", generation } = {}) {
    this.clearSourceClearRetryTimer();
    if (this.sourceClearPromise) {
      await this.sourceClearPromise;
    }
    if (generation !== this.playbackGeneration) return { cancelled: true };

    try {
      await this.refreshMissingTrackDuration(track);
    } catch (error) {
      if (generation !== this.playbackGeneration) return { cancelled: true };
      await this.clearSource({
        reason: "youtube_video_unavailable",
        track
      });
      return {
        unavailable: true,
        reason: error?.code ?? "youtube_video_unavailable",
        message: error?.message ?? String(error),
        durationSeconds: null
      };
    }

    if (generation !== this.playbackGeneration) return { cancelled: true };
    const playbackUrl = buildPlaybackUrl(track);
    // A source write already in flight cannot be cancelled at OBS. A stop must
    // queue a clear behind it even before the new track has become active.
    this.sourceClearNeeded = true;
    await this.setSourceUrl(playbackUrl, { generation });
    if (generation !== this.playbackGeneration) return { cancelled: true };
    this.activeTrackId = track.id;
    this.sourceClearNeeded = true;
    this.scheduleFinish(track);

    logInfo("Started OBS YouTube fallback playback", {
      track: formatTrack(track),
      reason,
      url: playbackUrl
    });

    return {
      durationSeconds: normalizeTrackDurationSeconds(track)
    };
  }

  async stopTrack(track, { clearSource = true } = {}) {
    if (this.desiredTrackId && track?.id && track.id !== this.desiredTrackId) {
      return;
    }

    ++this.playbackGeneration;
    this.desiredTrackId = "";
    if (!this.activeTrackId && !this.needsSourceClear()) {
      return;
    }

    this.clearFinishTimer();
    this.activeTrackId = "";

    if (!clearSource) {
      return;
    }

    return await this.clearSource({
      reason: "track_stop",
      track
    });
  }

  async clearSource({ reason = "", track = null } = {}) {
    ++this.playbackGeneration;
    this.desiredTrackId = "";
    this.clearFinishTimer();
    this.activeTrackId = "";

    if (!this.isConfigured()) {
      return false;
    }

    if (this.sourceClearPromise) {
      return this.sourceClearPromise;
    }

    this.clearSourceClearRetryTimer();

    this.sourceClearPromise = (async () => {
      try {
        await this.setSourceUrl(blankUrl);
        this.sourceClearNeeded = false;
        this.sourceClearRetryAttempt = 0;
        logInfo("Cleared OBS YouTube fallback source", {
          track: formatTrack(track),
          reason
        });
        return true;
      } catch (error) {
        this.sourceClearNeeded = true;
        logWarn("Failed to clear OBS YouTube fallback source", {
          track: formatTrack(track),
          reason,
          message: error?.message ?? String(error)
        });
        this.scheduleSourceClearRetry({ reason, track });
        return false;
      } finally {
        this.sourceClearPromise = null;
      }
    })();

    return this.sourceClearPromise;
  }

  async openLoginPage() {
    ++this.playbackGeneration;
    this.desiredTrackId = "";
    this.clearSourceClearRetryTimer();
    this.clearFinishTimer();
    this.activeTrackId = "";
    await this.setSourceUrl(youtubeLoginUrl);
    this.sourceClearNeeded = false;

    logInfo("Opened YouTube login page in OBS fallback source", {
      sourceName: this.getConfig().sourceName
    });

    return this.getStatus();
  }

  shutdown() {
    ++this.playbackGeneration;
    this.desiredTrackId = "";
    this.clearSourceClearRetryTimer();
    this.clearFinishTimer();
    this.activeTrackId = "";
  }
}
