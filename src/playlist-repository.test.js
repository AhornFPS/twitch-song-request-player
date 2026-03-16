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
        title: "Recovered Track Title"
      };
    }
  });

  await repository.init();

  const firstTrack = await repository.getRandomTrack();
  const secondTrack = await repository.getRandomTrack();
  const persistedPlaylist = await fs.readFile(playlistPath, "utf8");

  assert.equal(firstTrack?.title, "Recovered Track Title");
  assert.equal(secondTrack?.title, "Recovered Track Title");
  assert.equal(refreshCalls, 1);
  assert.match(persistedPlaylist, /Recovered Track Title/);
  assert.doesNotMatch(persistedPlaylist, /,undefined/);
});
