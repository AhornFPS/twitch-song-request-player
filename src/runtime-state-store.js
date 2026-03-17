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

export class RuntimeStateStore {
  constructor(filePath, { historyLimit = 25 } = {}) {
    this.filePath = filePath;
    this.historyLimit = historyLimit;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        queue: Array.isArray(parsed.queue)
          ? parsed.queue.map((track) => normalizeTrack(track)).filter(Boolean)
          : [],
        stoppedTrack: normalizeTrack(parsed.stoppedTrack),
        history: Array.isArray(parsed.history)
          ? parsed.history.map((entry) => normalizeHistoryEntry(entry)).filter(Boolean).slice(0, this.historyLimit)
          : []
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          queue: [],
          stoppedTrack: null,
          history: []
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
      stoppedTrack: normalizeTrack(state.stoppedTrack),
      history: Array.isArray(state.history)
        ? state.history.map((entry) => normalizeHistoryEntry(entry)).filter(Boolean).slice(0, this.historyLimit)
        : []
    };

    await fs.writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}
