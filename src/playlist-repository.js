import fs from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { logInfo, logWarn } from "./logger.js";
import { detectProvider, getTrackKey, resolveYouTubeTrackFromApi } from "./providers.js";

function normalizePlaylistTitle(value) {
  const title = typeof value === "string" ? value.trim() : "";

  if (title && title.toLowerCase() !== "undefined" && title.toLowerCase() !== "null") {
    return title;
  }

  return "";
}

function buildPlaylistRow(link, title) {
  const normalizedLink = typeof link === "string" ? link.trim() : "";
  const provider = detectProvider(normalizedLink);

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

export class PlaylistRepository {
  constructor(filePath, { youtubeApiKey = "", youtubeMetadataResolver = resolveYouTubeTrackFromApi } = {}) {
    this.filePath = filePath;
    this.youtubeApiKey = youtubeApiKey;
    this.youtubeMetadataResolver = youtubeMetadataResolver;
    this.rows = [];
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
        return;
      }

      throw error;
    }
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

  listTracks({ query = "", page = 1, pageSize = 100 } = {}) {
    const normalizedQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
    const safePageSize = Math.min(Math.max(Number.parseInt(String(pageSize), 10) || 100, 1), 250);
    const safePage = Math.max(Number.parseInt(String(page), 10) || 1, 1);
    const filteredRows = normalizedQuery
      ? this.rows.filter((row) => {
          const haystack = `${row.Title} ${row.Link} ${row.Provider}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        })
      : this.rows;
    const total = filteredRows.length;
    const totalPages = total === 0 ? 1 : Math.ceil(total / safePageSize);
    const normalizedPage = Math.min(safePage, totalPages);
    const start = (normalizedPage - 1) * safePageSize;
    const items = filteredRows.slice(start, start + safePageSize).map((row) => ({
      key: row.Key,
      url: row.Link,
      title: row.Title || row.Link,
      provider: row.Provider
    }));

    return {
      items,
      total,
      page: normalizedPage,
      pageSize: safePageSize,
      totalPages
    };
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
    await this.persist();
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

    if (this.rows.length === originalLength) {
      return false;
    }

    await this.persist();
    logWarn("Track removed from playlist", {
      title: track.title,
      provider: track.provider,
      url: track.url
    });
    return true;
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
}
