// @ts-nocheck
import OBSWebSocket from "obs-websocket-js";
import { formatTrack, logInfo, logWarn } from "./logger.js";

const youtubeLoginUrl = "https://www.youtube.com/";
const blankUrl = "about:blank";
const endedReason = "obs_youtube_fallback_timer";
const blockedEmbedReasons = new Set([
  "youtube_101",
  "youtube_150"
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
    playbackBufferSeconds = 4
  } = {}) {
    this.getSettings = typeof getSettings === "function" ? getSettings : () => ({});
    this.onTrackEnded = onTrackEnded;
    this.createClient = createClient;
    this.resolveTrackMetadata = typeof resolveTrackMetadata === "function"
      ? resolveTrackMetadata
      : null;
    this.playbackBufferSeconds = playbackBufferSeconds;
    this.activeTrackId = "";
    this.finishTimer = null;
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

  async setSourceUrl(url) {
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
      logWarn("Failed to refresh OBS YouTube fallback track duration", {
        track: formatTrack(track),
        message: error?.message ?? String(error)
      });
      return null;
    }
  }

  async startTrack(track, { reason = "" } = {}) {
    await this.refreshMissingTrackDuration(track);
    const playbackUrl = buildPlaybackUrl(track);
    await this.setSourceUrl(playbackUrl);
    this.activeTrackId = track.id;
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
    if (!this.activeTrackId) {
      return;
    }

    if (track?.id && track.id !== this.activeTrackId) {
      return;
    }

    this.clearFinishTimer();
    this.activeTrackId = "";

    if (!clearSource) {
      return;
    }

    await this.clearSource({
      reason: "track_stop",
      track
    });
  }

  async clearSource({ reason = "", track = null } = {}) {
    this.clearFinishTimer();
    this.activeTrackId = "";

    if (!this.isConfigured()) {
      return false;
    }

    try {
      await this.setSourceUrl(blankUrl);
      logInfo("Cleared OBS YouTube fallback source", {
        track: formatTrack(track),
        reason
      });
      return true;
    } catch (error) {
      logWarn("Failed to clear OBS YouTube fallback source", {
        track: formatTrack(track),
        reason,
        message: error?.message ?? String(error)
      });
      return false;
    }
  }

  async openLoginPage() {
    this.clearFinishTimer();
    this.activeTrackId = "";
    await this.setSourceUrl(youtubeLoginUrl);

    logInfo("Opened YouTube login page in OBS fallback source", {
      sourceName: this.getConfig().sourceName
    });

    return this.getStatus();
  }

  shutdown() {
    this.clearFinishTimer();
    this.activeTrackId = "";
  }
}
