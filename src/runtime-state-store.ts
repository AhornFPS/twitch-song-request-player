// @ts-nocheck
import fs from "node:fs/promises";

function normalizeTrack(track) {
  if (!track || typeof track !== "object") {
    return null;
  }

  if (!track.id || !track.provider || !track.url || !track.title || !track.key || !track.origin) {
    return null;
  }

  return {
    id: String(track.id),
    provider: String(track.provider),
    url: String(track.url),
    title: String(track.title),
    key: String(track.key),
    origin: String(track.origin),
    artworkUrl: typeof track.artworkUrl === "string" ? track.artworkUrl : "",
    audioUrl: typeof track.audioUrl === "string" ? track.audioUrl : "",
    durationSeconds: Number.isFinite(track.durationSeconds) ? track.durationSeconds : null,
    elapsedSeconds: Number.isFinite(track.elapsedSeconds) ? Math.max(track.elapsedSeconds, 0) : 0,
    sourceChannelId: typeof track.sourceChannelId === "string" ? track.sourceChannelId : "",
    sourceName: typeof track.sourceName === "string" ? track.sourceName : "",
    sourceUrl: typeof track.sourceUrl === "string" ? track.sourceUrl : "",
    requestedFromProvider: typeof track.requestedFromProvider === "string" ? track.requestedFromProvider : "",
    requestedFromUrl: typeof track.requestedFromUrl === "string" ? track.requestedFromUrl : "",
    requestedFromTitle: typeof track.requestedFromTitle === "string" ? track.requestedFromTitle : "",
    requestedFromName: typeof track.requestedFromName === "string" ? track.requestedFromName : "",
    requestedFromKey: typeof track.requestedFromKey === "string" ? track.requestedFromKey : "",
    radioSeedInput: typeof track.radioSeedInput === "string" ? track.radioSeedInput : "",
    isLive: track.isLive === true,
    requestedBy: track.requestedBy && typeof track.requestedBy === "object"
      ? {
          username: typeof track.requestedBy.username === "string" ? track.requestedBy.username : "",
          displayName: typeof track.requestedBy.displayName === "string" ? track.requestedBy.displayName : ""
        }
      : null
  };
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const track = normalizeTrack(entry.track);
  if (!track) {
    return null;
  }

  return {
    track,
    status: typeof entry.status === "string" ? entry.status : "ended",
    completedAt: typeof entry.completedAt === "string" ? entry.completedAt : new Date().toISOString()
  };
}

function normalizeAdminEvent(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return {
    action: typeof entry.action === "string" ? entry.action : "unknown",
    triggeredBy: typeof entry.triggeredBy === "string" ? entry.triggeredBy : "unknown",
    track: normalizeTrack(entry.track),
    details: entry.details && typeof entry.details === "object" ? entry.details : null,
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString()
  };
}

export class RuntimeStateStore {
  constructor(filePath, { historyLimit = 25, adminEventLimit = 50 } = {}) {
    this.filePath = filePath;
    this.historyLimit = historyLimit;
    this.adminEventLimit = adminEventLimit;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        queue: Array.isArray(parsed.queue)
          ? parsed.queue.map((track) => normalizeTrack(track)).filter(Boolean)
          : [],
        radioQueue: Array.isArray(parsed.radioQueue)
          ? parsed.radioQueue.map((track) => normalizeTrack(track)).filter(Boolean)
          : [],
        stoppedTrack: normalizeTrack(parsed.stoppedTrack),
        history: Array.isArray(parsed.history)
          ? parsed.history.map((entry) => normalizeHistoryEntry(entry)).filter(Boolean).slice(0, this.historyLimit)
          : [],
        adminEvents: Array.isArray(parsed.adminEvents)
          ? parsed.adminEvents.map((entry) => normalizeAdminEvent(entry)).filter(Boolean).slice(0, this.adminEventLimit)
          : []
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          queue: [],
          radioQueue: [],
          stoppedTrack: null,
          history: [],
          adminEvents: []
        };
      }

      throw error;
    }
  }

  async save(state) {
    const payload = {
      queue: Array.isArray(state.queue)
        ? state.queue.map((track) => normalizeTrack(track)).filter(Boolean)
        : [],
      radioQueue: Array.isArray(state.radioQueue)
        ? state.radioQueue.map((track) => normalizeTrack(track)).filter(Boolean)
        : [],
      stoppedTrack: normalizeTrack(state.stoppedTrack),
      history: Array.isArray(state.history)
        ? state.history.map((entry) => normalizeHistoryEntry(entry)).filter(Boolean).slice(0, this.historyLimit)
        : [],
      adminEvents: Array.isArray(state.adminEvents)
        ? state.adminEvents.map((entry) => normalizeAdminEvent(entry)).filter(Boolean).slice(0, this.adminEventLimit)
        : []
    };

    await fs.writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}
