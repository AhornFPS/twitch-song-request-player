// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PlaylistRepository } from "./playlist-repository.js";

test("playlist fallback refreshes undefined youtube titles from the API and persists them", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-playlist-repo-"));
  const playlistPath = path.join(runtimeDir, "playlist.csv");
  let refreshCalls = 0;

  t.after(async () => {
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  await fs.writeFile(
    playlistPath,
    "Link,Title\nhttps://youtu.be/dQw4w9WgXcQ,undefined\n",
    "utf8"
  );

  const repository = new PlaylistRepository(playlistPath, {
    youtubeApiKey: "api-key",
    youtubeMetadataResolver: async (url, apiKey) => {
      refreshCalls += 1;
      assert.equal(url, "https://youtu.be/dQw4w9WgXcQ");
      assert.equal(apiKey, "api-key");

      return {
        title: "Recovered Channel - Recovered Track Title"
      };
    }
  });

  await repository.init();

  const firstTrack = await repository.getRandomTrack();
  const secondTrack = await repository.getRandomTrack();
  const persistedPlaylist = await fs.readFile(playlistPath, "utf8");

  assert.equal(firstTrack?.title, "Recovered Channel - Recovered Track Title");
  assert.equal(secondTrack?.title, "Recovered Channel - Recovered Track Title");
  assert.equal(refreshCalls, 1);
  assert.match(persistedPlaylist, /Recovered Channel - Recovered Track Title/);
  assert.doesNotMatch(persistedPlaylist, /,undefined/);
});

test("playlist playback upgrades stored youtube titles without an artist separator", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-playlist-repo-"));
  const playlistPath = path.join(runtimeDir, "playlist.csv");
  let refreshCalls = 0;

  t.after(async () => {
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  await fs.writeFile(
    playlistPath,
    "Link,Title\nhttps://youtu.be/radio123,Radio\n",
    "utf8"
  );

  const repository = new PlaylistRepository(playlistPath, {
    youtubeApiKey: "api-key",
    youtubeMetadataResolver: async (url, apiKey) => {
      refreshCalls += 1;
      assert.equal(url, "https://youtu.be/radio123");
      assert.equal(apiKey, "api-key");

      return {
        title: "freak slug - Radio"
      };
    }
  });

  await repository.init();

  const track = await repository.getPlayableTrackForKey("youtube:radio123");
  const persistedPlaylist = await fs.readFile(playlistPath, "utf8");

  assert.equal(track?.title, "freak slug - Radio");
  assert.equal(refreshCalls, 1);
  assert.match(persistedPlaylist, /freak slug - Radio/);
  assert.doesNotMatch(persistedPlaylist, /,Radio/);
});

test("playlist repository lists, imports, exports, and deletes playlist rows", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-playlist-repo-"));
  const playlistPath = path.join(runtimeDir, "playlist.csv");

  t.after(async () => {
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  await fs.writeFile(
    playlistPath,
    [
      "Link,Title",
      "https://youtu.be/dQw4w9WgXcQ,Rick Roll",
      "https://soundcloud.com/artist/track,Club Mix"
    ].join("\n"),
    "utf8"
  );

  const repository = new PlaylistRepository(playlistPath);
  await repository.init();

  const listed = repository.listTracks({
    query: "club",
    page: 1,
    pageSize: 10,
    sortBy: "title"
  });

  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].title, "Club Mix");
  assert.equal(listed.sortBy, "title");

  const importSummary = await repository.importFromCsv(
    [
      "Link,Title",
      "https://youtu.be/dQw4w9WgXcQ,Rick Roll Duplicate",
      "https://youtu.be/9bZkp7q19f0,Gangnam Style"
    ].join("\n"),
    {
      mode: "append"
    }
  );

  assert.equal(importSummary.importedCount, 1);
  assert.equal(importSummary.duplicateCount, 1);
  assert.equal(importSummary.finalCount, 3);
  assert.match(repository.exportCsv(), /Gangnam Style/);

  const removed = await repository.removeTrackByKey("youtube:9bZkp7q19f0");
  assert.equal(removed, true);
  assert.equal(repository.listTracks().total, 2);

  const bulkRemoval = await repository.removeTracksByKeys([
    "youtube:dQw4w9WgXcQ",
    "youtube:missing"
  ]);
  assert.equal(bulkRemoval.removedCount, 1);
  assert.deepEqual(bulkRemoval.removedKeys, ["youtube:dQw4w9WgXcQ"]);
  assert.equal(repository.listTracks().total, 1);
});

test("playlist repository can edit titles, refresh metadata, and export selected rows", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-playlist-repo-"));
  const playlistPath = path.join(runtimeDir, "playlist.csv");

  t.after(async () => {
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  await fs.writeFile(
    playlistPath,
    [
      "Link,Title",
      "https://youtu.be/dQw4w9WgXcQ,Old Title",
      "https://soundcloud.com/artist/track,Club Mix"
    ].join("\n"),
    "utf8"
  );

  const repository = new PlaylistRepository(playlistPath, {
    youtubeApiKey: "api-key",
    youtubeMetadataResolver: async () => ({
      title: "Refreshed Title"
    }),
    metadataResolver: async (url) => ({
      title: url.includes("soundcloud") ? "Refreshed SoundCloud Title" : "Fallback Title"
    })
  });
  await repository.init();

  const updatedTrack = await repository.updateTrackTitleByKey("youtube:dQw4w9WgXcQ", "Manual Title");
  assert.equal(updatedTrack?.title, "Manual Title");

  const refreshedTrack = await repository.refreshTrackMetadataByKey("youtube:dQw4w9WgXcQ");
  assert.equal(refreshedTrack?.title, "Refreshed Title");

  const exportedCsv = repository.exportSelectedCsv([
    "soundcloud:https://soundcloud.com/artist/track"
  ]);
  assert.match(exportedCsv, /Club Mix/);
  assert.doesNotMatch(exportedCsv, /Refreshed Title/);
});

test("playlist repository resolves saved Suno tracks into playable entries", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-playlist-repo-"));
  const playlistPath = path.join(runtimeDir, "playlist.csv");

  t.after(async () => {
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  await fs.writeFile(
    playlistPath,
    [
      "Link,Title",
      "https://suno.com/song/suno123,Stored Suno Title"
    ].join("\n"),
    "utf8"
  );

  const repository = new PlaylistRepository(playlistPath, {
    metadataResolver: async (url) => ({
      provider: "suno",
      url,
      title: "Resolved Suno Title",
      key: "suno:suno123",
      artworkUrl: "https://cdn2.suno.ai/suno123.jpeg",
      audioUrl: "https://cdn1.suno.ai/suno123.mp3"
    })
  });
  await repository.init();

  const track = await repository.getPlayableTrackForKey("suno:suno123");

  assert.equal(track?.provider, "suno");
  assert.equal(track?.title, "Resolved Suno Title");
  assert.equal(track?.audioUrl, "https://cdn1.suno.ai/suno123.mp3");
  assert.equal(track?.origin, "playlist");
});

test("playlist repository tracks flagged failures and clears them after a successful refresh", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-playlist-repo-"));
  const playlistPath = path.join(runtimeDir, "playlist.csv");

  t.after(async () => {
    await fs.rm(runtimeDir, {
      recursive: true,
      force: true
    });
  });

  await fs.writeFile(
    playlistPath,
    [
      "Link,Title",
      "https://youtu.be/dQw4w9WgXcQ,Review Me",
      "https://soundcloud.com/artist/track,Club Mix"
    ].join("\n"),
    "utf8"
  );

  const repository = new PlaylistRepository(playlistPath, {
    youtubeApiKey: "api-key",
    youtubeMetadataResolver: async () => ({
      title: "Recovered Title"
    })
  });
  await repository.init();

  await repository.recordTrackPlaybackFailure({
    key: "youtube:dQw4w9WgXcQ"
  }, {
    reason: "youtube_startup_timeout",
    message: "The embed never started."
  });
  await repository.recordTrackPlaybackFailure({
    key: "youtube:dQw4w9WgXcQ"
  }, {
    reason: "youtube_startup_timeout",
    message: "The embed never started again."
  });

  const reviewBeforeRefresh = repository.listReviewTracks();
  assert.equal(reviewBeforeRefresh.summary.flaggedCount, 1);
  assert.equal(reviewBeforeRefresh.items[0].key, "youtube:dQw4w9WgXcQ");
  assert.equal(reviewBeforeRefresh.items[0].health.failureCount, 2);
  assert.equal(reviewBeforeRefresh.items[0].health.consecutiveFailureCount, 2);
  const flaggedTrack = repository.listTracks().items.find((item) => item.key === "youtube:dQw4w9WgXcQ");
  assert.equal(flaggedTrack?.health.flagged, true);

  const refreshedTrack = await repository.refreshTrackMetadataByKey("youtube:dQw4w9WgXcQ");
  assert.equal(refreshedTrack?.title, "Recovered Title");
  assert.equal(refreshedTrack?.health.flagged, false);
  assert.equal(refreshedTrack?.health.failureCount, 2);
  assert.equal(repository.listReviewTracks().summary.flaggedCount, 0);
});
