// @ts-nocheck
import fs from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { logInfo, logWarn } from "./logger.js";
import { PlaylistHealthStore } from "./playlist-health-store.js";
import { detectPlayableProvider, getTrackKey, resolveTrackFromUrl, resolveYouTubeTrackFromApi } from "./providers.js";

function normalizePlaylistTitle(value) {
  const title = typeof value === "string" ? value.trim() : "";

  if (title && title.toLowerCase() !== "undefined" && title.toLowerCase() !== "null") {
    return title;
  }

  return "";
}

function buildPlaylistRow(link, title) {
  const normalizedLink = typeof link === "string" ? link.trim() : "";
  const provider = detectPlayableProvider(normalizedLink);

  if (!normalizedLink || !provider) {
    return null;
  }

  return {
    Link: normalizedLink,
    Title: normalizePlaylistTitle(title),
    Provider: provider,
    Key: getTrackKey(provider, normalizedLink)
  };
}

function parsePlaylistRows(csvText) {
  if (typeof csvText !== "string" || !csvText.trim()) {
    return [];
  }

  const parsedRows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  return parsedRows
    .map((row) => buildPlaylistRow(row.Link, row.Title))
    .filter(Boolean);
}

function normalizePlaylistSort(sortBy) {
  return ["recent", "title", "provider"].includes(sortBy) ? sortBy : "recent";
}

function normalizePlaylistHealthEntry(entry = {}) {
  return {
    failureCount: Number.isInteger(entry.failureCount) && entry.failureCount >= 0 ? entry.failureCount : 0,
    consecutiveFailureCount: Number.isInteger(entry.consecutiveFailureCount) && entry.consecutiveFailureCount >= 0
      ? entry.consecutiveFailureCount
      : 0,
    lastFailureAt: typeof entry.lastFailureAt === "string" ? entry.lastFailureAt : null,
    lastFailureReason: typeof entry.lastFailureReason === "string" ? entry.lastFailureReason : "",
    lastFailureMessage: typeof entry.lastFailureMessage === "string" ? entry.lastFailureMessage : "",
    lastFailureSource: typeof entry.lastFailureSource === "string" ? entry.lastFailureSource : "",
    lastSuccessAt: typeof entry.lastSuccessAt === "string" ? entry.lastSuccessAt : null,
    lastRecoveredAt: typeof entry.lastRecoveredAt === "string" ? entry.lastRecoveredAt : null
  };
}

export class PlaylistRepository {
  constructor(filePath, {
    healthStore = null,
    healthPath = "",
    youtubeApiKey = "",
    youtubeMetadataResolver = resolveYouTubeTrackFromApi,
    metadataResolver = resolveTrackFromUrl
  } = {}) {
    this.filePath = filePath;
    this.healthStore = healthStore ?? new PlaylistHealthStore(healthPath || `${filePath}.health.json`);
    this.youtubeApiKey = youtubeApiKey;
    this.youtubeMetadataResolver = youtubeMetadataResolver;
    this.metadataResolver = metadataResolver;
    this.rows = [];
    this.healthByKey = new Map();
  }

  setYoutubeApiKey(youtubeApiKey) {
    this.youtubeApiKey = typeof youtubeApiKey === "string" ? youtubeApiKey.trim() : "";
  }

  async init() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsedRows = parse(raw, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
      this.rows = parsePlaylistRows(raw);
      logInfo("Playlist initialized", {
        filePath: this.filePath,
        loadedRows: parsedRows.length,
        usableRows: this.rows.length
      });
    } catch (error) {
      if (error.code === "ENOENT") {
        this.rows = [];
        await this.persist();
        logWarn("Playlist file was missing and has been recreated", {
          filePath: this.filePath
        });
      } else {
        throw error;
      }
    }

    await this.loadHealthState();
  }

  async loadHealthState() {
    const persistedHealth = await this.healthStore.load();
    this.healthByKey = new Map(Object.entries(persistedHealth.items ?? {}));
    await this.pruneHealthState();
  }

  async getRandomTrack() {
    if (this.rows.length === 0) {
      logWarn("Playlist fallback requested but there are no usable tracks");
      return null;
    }

    const row = this.rows[Math.floor(Math.random() * this.rows.length)];
    await this.refreshMissingYoutubeTitle(row);

    logInfo("Selected fallback playlist track", {
      provider: row.Provider,
      title: row.Title || row.Link,
      url: row.Link
    });

    return {
      provider: row.Provider,
      url: row.Link,
      title: row.Title || row.Link,
      key: row.Key,
      origin: "playlist",
      requestedBy: null,
      artworkUrl: ""
    };
  }

  async refreshMissingYoutubeTitle(row) {
    if (row.Provider !== "youtube" || row.Title) {
      return;
    }

    if (!this.youtubeApiKey) {
      logWarn("Playlist track is missing a title and cannot be refreshed without a YouTube API key", {
        url: row.Link
      });
      return;
    }

    try {
      const refreshedTrack = await this.youtubeMetadataResolver(row.Link, this.youtubeApiKey);
      const refreshedTitle = normalizePlaylistTitle(refreshedTrack.title);

      if (!refreshedTitle) {
        return;
      }

      row.Title = refreshedTitle;
      await this.persist();
      logInfo("Refreshed missing YouTube playlist title", {
        title: row.Title,
        url: row.Link
      });
    } catch (error) {
      logWarn("Failed to refresh missing YouTube playlist title", {
        url: row.Link,
        message: error?.message ?? String(error)
      });
    }
  }

  hasTrack(track) {
    return this.rows.some((row) => row.Key === track.key);
  }

  findTrackByKey(trackKey) {
    return this.rows.find((row) => row.Key === trackKey) ?? null;
  }

  buildTrackHealth(trackKey) {
    const health = normalizePlaylistHealthEntry(this.healthByKey.get(trackKey));

    return {
      ...health,
      flagged: health.consecutiveFailureCount > 0
    };
  }

  buildTrackPayload(row) {
    return {
      key: row.Key,
      url: row.Link,
      title: row.Title || row.Link,
      provider: row.Provider,
      health: this.buildTrackHealth(row.Key)
    };
  }

  async pruneHealthState() {
    const validTrackKeys = new Set(this.rows.map((row) => row.Key));
    let changed = false;

    for (const trackKey of Array.from(this.healthByKey.keys())) {
      if (!validTrackKeys.has(trackKey)) {
        this.healthByKey.delete(trackKey);
        changed = true;
      }
    }

    if (changed) {
      await this.persistHealthState();
    }
  }

  listTracks({ query = "", page = 1, pageSize = 100, sortBy = "recent" } = {}) {
    const normalizedQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
    const safePageSize = Math.min(Math.max(Number.parseInt(String(pageSize), 10) || 100, 1), 250);
    const safePage = Math.max(Number.parseInt(String(page), 10) || 1, 1);
    const normalizedSort = normalizePlaylistSort(sortBy);
    const filteredRows = normalizedQuery
      ? this.rows.filter((row) => {
          const haystack = `${row.Title} ${row.Link} ${row.Provider}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        })
      : this.rows;
    const sortedRows = filteredRows
      .map((row) => ({
        row,
        index: this.rows.indexOf(row)
      }))
      .sort((left, right) => {
        if (normalizedSort === "title") {
          return (left.row.Title || left.row.Link).localeCompare(right.row.Title || right.row.Link);
        }

        if (normalizedSort === "provider") {
          const providerComparison = left.row.Provider.localeCompare(right.row.Provider);
          if (providerComparison !== 0) {
            return providerComparison;
          }

          return (left.row.Title || left.row.Link).localeCompare(right.row.Title || right.row.Link);
        }

        return right.index - left.index;
      })
      .map(({ row }) => row);
    const total = sortedRows.length;
    const totalPages = total === 0 ? 1 : Math.ceil(total / safePageSize);
    const normalizedPage = Math.min(safePage, totalPages);
    const start = (normalizedPage - 1) * safePageSize;
    const items = sortedRows.slice(start, start + safePageSize).map((row) => this.buildTrackPayload(row));

    return {
      items,
      total,
      page: normalizedPage,
      pageSize: safePageSize,
      totalPages,
      sortBy: normalizedSort
    };
  }

  listReviewTracks({ limit = 25 } = {}) {
    const safeLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 25, 1), 100);
    const reviewItems = this.rows
      .map((row) => this.buildTrackPayload(row))
      .filter((track) => track.health.flagged)
      .sort((left, right) => {
        const consecutiveDifference = (right.health.consecutiveFailureCount || 0) - (left.health.consecutiveFailureCount || 0);
        if (consecutiveDifference !== 0) {
          return consecutiveDifference;
        }

        const failureDifference = (right.health.failureCount || 0) - (left.health.failureCount || 0);
        if (failureDifference !== 0) {
          return failureDifference;
        }

        return String(right.health.lastFailureAt || "").localeCompare(String(left.health.lastFailureAt || ""));
      });

    const healthEntries = Array.from(this.healthByKey.values()).map((entry) => normalizePlaylistHealthEntry(entry));

    return {
      items: reviewItems.slice(0, safeLimit),
      summary: {
        flaggedCount: reviewItems.length,
        totalFailureCount: healthEntries.reduce((sum, entry) => sum + entry.failureCount, 0),
        lastFailureAt: healthEntries
          .map((entry) => entry.lastFailureAt)
          .filter(Boolean)
          .sort((left, right) => String(right).localeCompare(String(left)))[0] ?? null
      }
    };
  }

  getTrackForKey(trackKey) {
    const row = this.findTrackByKey(trackKey);

    if (!row) {
      return null;
    }

    return {
      provider: row.Provider,
      url: row.Link,
      title: row.Title || row.Link,
      key: row.Key,
      origin: "playlist",
      requestedBy: null,
      artworkUrl: ""
    };
  }

  async recordTrackPlaybackFailure(track, {
    reason = "playback_error",
    message = "",
    source = "player"
  } = {}) {
    const row = this.findTrackByKey(track?.key);
    if (!row) {
      return null;
    }

    const now = new Date().toISOString();
    const nextHealth = normalizePlaylistHealthEntry(this.healthByKey.get(row.Key));
    nextHealth.failureCount += 1;
    nextHealth.consecutiveFailureCount += 1;
    nextHealth.lastFailureAt = now;
    nextHealth.lastFailureReason = typeof reason === "string" ? reason : "playback_error";
    nextHealth.lastFailureMessage = typeof message === "string" ? message : "";
    nextHealth.lastFailureSource = typeof source === "string" ? source : "player";
    this.healthByKey.set(row.Key, nextHealth);
    await this.persistHealthState();

    return this.buildTrackPayload(row);
  }

  async recordTrackPlaybackSuccess(track) {
    const row = this.findTrackByKey(track?.key);
    if (!row) {
      return null;
    }

    const existingHealth = this.healthByKey.get(row.Key);
    if (!existingHealth) {
      return null;
    }

    const now = new Date().toISOString();
    const nextHealth = normalizePlaylistHealthEntry(existingHealth);
    nextHealth.lastSuccessAt = now;
    if (nextHealth.consecutiveFailureCount > 0) {
      nextHealth.consecutiveFailureCount = 0;
      nextHealth.lastRecoveredAt = now;
    }
    this.healthByKey.set(row.Key, nextHealth);
    await this.persistHealthState();

    return this.buildTrackPayload(row);
  }

  async clearTrackHealthByKey(trackKey) {
    const row = this.findTrackByKey(trackKey);
    if (!row) {
      return null;
    }

    const existingHealth = this.healthByKey.get(trackKey);
    if (!existingHealth) {
      return this.buildTrackPayload(row);
    }

    const now = new Date().toISOString();
    const nextHealth = normalizePlaylistHealthEntry(existingHealth);
    nextHealth.consecutiveFailureCount = 0;
    nextHealth.lastRecoveredAt = now;
    nextHealth.lastSuccessAt = now;
    this.healthByKey.set(trackKey, nextHealth);
    await this.persistHealthState();

    return this.buildTrackPayload(row);
  }

  async updateTrackTitleByKey(trackKey, nextTitle) {
    const row = this.findTrackByKey(trackKey);

    if (!row) {
      return null;
    }

    const normalizedTitle = normalizePlaylistTitle(nextTitle);
    if (!normalizedTitle) {
      throw new Error("Title is required.");
    }

    row.Title = normalizedTitle;
    await this.persist();

    return this.buildTrackPayload(row);
  }

  async refreshTrackMetadataByKey(trackKey) {
    const row = this.findTrackByKey(trackKey);

    if (!row) {
      return null;
    }

    let refreshedTrack = null;
    try {
      if (row.Provider === "youtube" && this.youtubeApiKey) {
        refreshedTrack = await this.youtubeMetadataResolver(row.Link, this.youtubeApiKey);
      } else {
        refreshedTrack = await this.metadataResolver(row.Link);
      }
    } catch (error) {
      await this.recordTrackPlaybackFailure({
        key: row.Key
      }, {
        reason: "metadata_refresh_failed",
        message: error?.message ?? String(error),
        source: "library_refresh"
      });
      throw error;
    }

    const refreshedTitle = normalizePlaylistTitle(refreshedTrack?.title) || row.Title || row.Link;
    row.Title = refreshedTitle;
    await this.persist();
    await this.clearTrackHealthByKey(row.Key);

    return this.buildTrackPayload(row);
  }

  async appendTrack(track) {
    if (this.hasTrack(track)) {
      return false;
    }

    this.rows.push({
      Link: track.url,
      Title: normalizePlaylistTitle(track.title),
      Provider: track.provider,
      Key: track.key
    });

    await this.persist();
    logInfo("Track appended to playlist", {
      title: track.title,
      provider: track.provider,
      url: track.url
    });
    return true;
  }

  async removeTrackByKey(trackKey) {
    const track = this.findTrackByKey(trackKey);

    if (!track) {
      return false;
    }

    this.rows = this.rows.filter((row) => row.Key !== trackKey);
    this.healthByKey.delete(trackKey);
    await this.persist();
    await this.persistHealthState();
    logWarn("Track removed from playlist by key", {
      key: trackKey,
      title: track.Title || track.Link,
      provider: track.Provider,
      url: track.Link
    });
    return true;
  }

  async removeTrack(track) {
    const originalLength = this.rows.length;
    this.rows = this.rows.filter((row) => row.Key !== track.key);
    this.healthByKey.delete(track.key);

    if (this.rows.length === originalLength) {
      return false;
    }

    await this.persist();
    await this.persistHealthState();
    logWarn("Track removed from playlist", {
      title: track.title,
      provider: track.provider,
      url: track.url
    });
    return true;
  }

  async removeTracksByKeys(trackKeys) {
    const uniqueTrackKeys = Array.from(
      new Set(
        Array.isArray(trackKeys)
          ? trackKeys.map((trackKey) => typeof trackKey === "string" ? trackKey.trim() : "").filter(Boolean)
          : []
      )
    );

    if (uniqueTrackKeys.length === 0) {
      return {
        removedCount: 0,
        removedKeys: []
      };
    }

    const matchingKeys = uniqueTrackKeys.filter((trackKey) => this.findTrackByKey(trackKey));
    if (matchingKeys.length === 0) {
      return {
        removedCount: 0,
        removedKeys: []
      };
    }

    this.rows = this.rows.filter((row) => !matchingKeys.includes(row.Key));
    matchingKeys.forEach((trackKey) => {
      this.healthByKey.delete(trackKey);
    });
    await this.persist();
    await this.persistHealthState();
    logWarn("Removed multiple tracks from playlist", {
      removedCount: matchingKeys.length
    });

    return {
      removedCount: matchingKeys.length,
      removedKeys: matchingKeys
    };
  }

  exportCsv() {
    return stringify(
      this.rows.map((row) => ({
        Link: row.Link,
        Title: row.Title
      })),
      {
        header: true,
        columns: ["Link", "Title"]
      }
    );
  }

  exportSelectedCsv(trackKeys) {
    const uniqueTrackKeys = new Set(
      Array.isArray(trackKeys)
        ? trackKeys.map((trackKey) => typeof trackKey === "string" ? trackKey.trim() : "").filter(Boolean)
        : []
    );
    const selectedRows = this.rows.filter((row) => uniqueTrackKeys.has(row.Key));

    return stringify(
      selectedRows.map((row) => ({
        Link: row.Link,
        Title: row.Title
      })),
      {
        header: true,
        columns: ["Link", "Title"]
      }
    );
  }

  async importFromCsv(csvText, { mode = "append" } = {}) {
    const normalizedMode = mode === "replace" ? "replace" : "append";
    const incomingRows = parsePlaylistRows(csvText);
    const seenKeys = new Set();
    const dedupedIncomingRows = [];
    let duplicateRows = 0;

    for (const row of incomingRows) {
      if (seenKeys.has(row.Key)) {
        duplicateRows += 1;
        continue;
      }

      seenKeys.add(row.Key);
      dedupedIncomingRows.push(row);
    }

    let importedCount = 0;

    if (normalizedMode === "replace") {
      importedCount = dedupedIncomingRows.length;
      this.rows = dedupedIncomingRows;
      await this.persist();
      await this.pruneHealthState();
    } else {
      const existingKeys = new Set(this.rows.map((row) => row.Key));
      const appendRows = dedupedIncomingRows.filter((row) => {
        if (existingKeys.has(row.Key)) {
          duplicateRows += 1;
          return false;
        }

        existingKeys.add(row.Key);
        return true;
      });

      if (appendRows.length > 0) {
        this.rows.push(...appendRows);
        importedCount = appendRows.length;
        await this.persist();
      }
    }

    return {
      importedCount,
      duplicateCount: duplicateRows,
      totalRows: incomingRows.length,
      finalCount: this.rows.length,
      mode: normalizedMode
    };
  }

  async persist() {
    await fs.writeFile(this.filePath, this.exportCsv(), "utf8");
  }

  async persistHealthState() {
    await this.healthStore.save({
      items: Object.fromEntries(this.healthByKey.entries())
    });
  }
}
