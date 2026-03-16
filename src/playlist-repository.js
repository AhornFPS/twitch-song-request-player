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

      const filteredRows = parsedRows.map((row) => {
        const link = row.Link?.trim() ?? "";
        const title = normalizePlaylistTitle(row.Title);
        const provider = detectProvider(link);

        return {
          Link: link,
          Title: title,
          Provider: provider,
          Key: provider ? getTrackKey(provider, link) : link
        };
      }).filter((row) => row.Link && row.Provider);

      this.rows = filteredRows;
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

  async persist() {
    const csv = stringify(
      this.rows.map((row) => ({
        Link: row.Link,
        Title: row.Title
      })),
      {
        header: true,
        columns: ["Link", "Title"]
      }
    );

    await fs.writeFile(this.filePath, csv, "utf8");
  }
}
