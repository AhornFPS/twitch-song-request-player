// @ts-nocheck
import fs from "node:fs/promises";

function normalizeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeTimestamp(value) {
  return typeof value === "string" && value ? value : null;
}

function normalizeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizePlaylistHealthEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return {
    failureCount: normalizeCount(entry.failureCount),
    consecutiveFailureCount: normalizeCount(entry.consecutiveFailureCount),
    lastFailureAt: normalizeTimestamp(entry.lastFailureAt),
    lastFailureReason: normalizeString(entry.lastFailureReason),
    lastFailureMessage: normalizeString(entry.lastFailureMessage),
    lastFailureSource: normalizeString(entry.lastFailureSource),
    lastSuccessAt: normalizeTimestamp(entry.lastSuccessAt),
    lastRecoveredAt: normalizeTimestamp(entry.lastRecoveredAt)
  };
}

export class PlaylistHealthStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const items = parsed?.items && typeof parsed.items === "object"
        ? Object.fromEntries(
            Object.entries(parsed.items)
              .map(([trackKey, entry]) => [trackKey, normalizePlaylistHealthEntry(entry)])
              .filter(([, entry]) => Boolean(entry))
          )
        : {};

      return { items };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          items: {}
        };
      }

      throw error;
    }
  }

  async save(state) {
    const payload = {
      items: state?.items && typeof state.items === "object"
        ? Object.fromEntries(
            Object.entries(state.items)
              .map(([trackKey, entry]) => [trackKey, normalizePlaylistHealthEntry(entry)])
              .filter(([, entry]) => Boolean(entry))
          )
        : {}
    };

    await fs.writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}
