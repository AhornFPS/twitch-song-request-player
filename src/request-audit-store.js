import fs from "node:fs/promises";

function normalizeRequester(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const username = typeof value.username === "string" ? value.username : "";
  const displayName = typeof value.displayName === "string" ? value.displayName : "";

  if (!username && !displayName) {
    return null;
  }

  return {
    username,
    displayName
  };
}

function normalizeAuditTrack(track) {
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
    key,
    origin: typeof track.origin === "string" ? track.origin : "",
    artworkUrl: typeof track.artworkUrl === "string" ? track.artworkUrl : "",
    durationSeconds: Number.isFinite(track.durationSeconds) ? track.durationSeconds : null,
    isLive: track.isLive === true,
    sourceName: typeof track.sourceName === "string" ? track.sourceName : "",
    sourceChannelId: typeof track.sourceChannelId === "string" ? track.sourceChannelId : "",
    sourceUrl: typeof track.sourceUrl === "string" ? track.sourceUrl : ""
  };
}

function normalizeQueueState(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    playbackStatus: typeof value.playbackStatus === "string" ? value.playbackStatus : "idle",
    queueLength: Number.isInteger(value.queueLength) && value.queueLength >= 0 ? value.queueLength : 0,
    currentTrackId: typeof value.currentTrackId === "string" ? value.currentTrackId : "",
    stoppedTrackId: typeof value.stoppedTrackId === "string" ? value.stoppedTrackId : ""
  };
}

function normalizeRequesterStatsSnapshot(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    requester: normalizeRequester(value.requester),
    totalRequests: Number.isInteger(value.totalRequests) && value.totalRequests >= 0 ? value.totalRequests : 0,
    acceptedRequests: Number.isInteger(value.acceptedRequests) && value.acceptedRequests >= 0 ? value.acceptedRequests : 0,
    duplicateRequests: Number.isInteger(value.duplicateRequests) && value.duplicateRequests >= 0 ? value.duplicateRequests : 0,
    rejectedRequests: Number.isInteger(value.rejectedRequests) && value.rejectedRequests >= 0 ? value.rejectedRequests : 0,
    youtubeRequests: Number.isInteger(value.youtubeRequests) && value.youtubeRequests >= 0 ? value.youtubeRequests : 0,
    soundcloudRequests: Number.isInteger(value.soundcloudRequests) && value.soundcloudRequests >= 0 ? value.soundcloudRequests : 0,
    lastRequestedAt: typeof value.lastRequestedAt === "string" ? value.lastRequestedAt : null,
    lastAcceptedAt: typeof value.lastAcceptedAt === "string" ? value.lastAcceptedAt : null,
    lastOutcome: typeof value.lastOutcome === "string" ? value.lastOutcome : "",
    lastSource: typeof value.lastSource === "string" ? value.lastSource : "",
    lastInput: typeof value.lastInput === "string" ? value.lastInput : "",
    lastTrackKey: typeof value.lastTrackKey === "string" ? value.lastTrackKey : "",
    lastTrackTitle: typeof value.lastTrackTitle === "string" ? value.lastTrackTitle : ""
  };
}

function normalizeRequestEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  return {
    id: typeof event.id === "string" ? event.id : "",
    createdAt: typeof event.createdAt === "string" ? event.createdAt : new Date().toISOString(),
    source: typeof event.source === "string" ? event.source : "unknown",
    outcome: typeof event.outcome === "string" ? event.outcome : "rejected",
    reason: typeof event.reason === "string" ? event.reason : "",
    message: typeof event.message === "string" ? event.message : "",
    input: typeof event.input === "string" ? event.input : "",
    bypassRequestLimits: event.bypassRequestLimits === true,
    requester: normalizeRequester(event.requester),
    track: normalizeAuditTrack(event.track),
    queueState: normalizeQueueState(event.queueState),
    requesterStats: normalizeRequesterStatsSnapshot(event.requesterStats),
    details: event.details && typeof event.details === "object" ? event.details : null
  };
}

function normalizeRequesterStatEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const requester = normalizeRequester(entry.requester);
  if (!requester) {
    return null;
  }

  return {
    requester,
    totalRequests: Number.isInteger(entry.totalRequests) && entry.totalRequests >= 0 ? entry.totalRequests : 0,
    acceptedRequests: Number.isInteger(entry.acceptedRequests) && entry.acceptedRequests >= 0 ? entry.acceptedRequests : 0,
    duplicateRequests: Number.isInteger(entry.duplicateRequests) && entry.duplicateRequests >= 0 ? entry.duplicateRequests : 0,
    rejectedRequests: Number.isInteger(entry.rejectedRequests) && entry.rejectedRequests >= 0 ? entry.rejectedRequests : 0,
    youtubeRequests: Number.isInteger(entry.youtubeRequests) && entry.youtubeRequests >= 0 ? entry.youtubeRequests : 0,
    soundcloudRequests: Number.isInteger(entry.soundcloudRequests) && entry.soundcloudRequests >= 0 ? entry.soundcloudRequests : 0,
    lastRequestedAt: typeof entry.lastRequestedAt === "string" ? entry.lastRequestedAt : null,
    lastAcceptedAt: typeof entry.lastAcceptedAt === "string" ? entry.lastAcceptedAt : null,
    lastOutcome: typeof entry.lastOutcome === "string" ? entry.lastOutcome : "",
    lastSource: typeof entry.lastSource === "string" ? entry.lastSource : "",
    lastInput: typeof entry.lastInput === "string" ? entry.lastInput : "",
    lastTrackKey: typeof entry.lastTrackKey === "string" ? entry.lastTrackKey : "",
    lastTrackTitle: typeof entry.lastTrackTitle === "string" ? entry.lastTrackTitle : ""
  };
}

export class RequestAuditStore {
  constructor(filePath, { eventLimit = 1000 } = {}) {
    this.filePath = filePath;
    this.eventLimit = eventLimit;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const requesterStats = parsed.requesterStats && typeof parsed.requesterStats === "object"
        ? Object.fromEntries(
            Object.entries(parsed.requesterStats)
              .map(([key, value]) => [key, normalizeRequesterStatEntry(value)])
              .filter(([, value]) => Boolean(value))
          )
        : {};

      return {
        events: Array.isArray(parsed.events)
          ? parsed.events.map((event) => normalizeRequestEvent(event)).filter(Boolean).slice(0, this.eventLimit)
          : [],
        requesterStats
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          events: [],
          requesterStats: {}
        };
      }

      throw error;
    }
  }

  async save(state) {
    const payload = {
      events: Array.isArray(state.events)
        ? state.events.map((event) => normalizeRequestEvent(event)).filter(Boolean).slice(0, this.eventLimit)
        : [],
      requesterStats: state.requesterStats && typeof state.requesterStats === "object"
        ? Object.fromEntries(
            Object.entries(state.requesterStats)
              .map(([key, value]) => [key, normalizeRequesterStatEntry(value)])
              .filter(([, value]) => Boolean(value))
          )
        : {}
    };

    await fs.writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}
