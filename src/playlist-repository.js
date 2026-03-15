import fs from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { logInfo, logWarn } from "./logger.js";
import { detectProvider, getTrackKey } from "./providers.js";

export class PlaylistRepository {
  constructor(filePath) {
    this.filePath = filePath;
    this.rows = [];
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
        const title = row.Title?.trim() ?? "";
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

  getRandomTrack() {
    if (this.rows.length === 0) {
      logWarn("Playlist fallback requested but there are no usable tracks");
      return null;
    }

    const row = this.rows[Math.floor(Math.random() * this.rows.length)];
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

  hasTrack(track) {
    return this.rows.some((row) => row.Key === track.key);
  }

  async appendTrack(track) {
    if (this.hasTrack(track)) {
      return false;
    }

    this.rows.push({
      Link: track.url,
      Title: track.title,
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
