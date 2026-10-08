// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startAppServer } from "./app-server.js";
import { createConfigStore } from "./config.js";
import { extractYouTubePlaylistId, resolveYouTubePlaylistFromApi } from "./providers.js";

const playlistUrl = "https://www.youtube.com/playlist?list=PLimport";
const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { "Content-Type": "application/json" }
});
const entry = (videoId) => ({ contentDetails: { videoId } });
const video = (id) => ({
  id, snippet: { title: `Artist - Song ${id}`, channelTitle: "Artist" },
  contentDetails: { duration: "PT3M" }, status: { privacyStatus: "public", embeddable: true }
});

test("playlist import validates links and a configured key before contacting YouTube", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => { assert.fail("Invalid imports must not fetch."); };
  t.after(() => { global.fetch = originalFetch; });
  for (const url of ["", "not a link", "https://youtube.com.example/playlist?list=PLimport", "https://soundcloud.com/user/track", "https://youtube.com/watch?v=one", "ftp://youtube.com/playlist?list=PLimport"]) {
    await assert.rejects(resolveYouTubePlaylistFromApi(url, "test-key"), /YouTube.*URL/);
  }
  await assert.rejects(resolveYouTubePlaylistFromApi(playlistUrl, ""), /API key in Settings/);
  for (const url of [playlistUrl, "https://youtu.be/one?list=PLimport", "https://music.youtube.com/watch?v=one&list=PLimport", "https://m.youtube.com/playlist?list=PLimport"]) {
    assert.equal(extractYouTubePlaylistId(url), "PLimport");
  }
});

test("playlist import reads every page, batches metadata, preserves order and counts skipped entries", async (t) => {
  const originalFetch = global.fetch;
  const ids = Array.from({ length: 51 }, (_, i) => `video-${i}`);
  const batches = [];
  const pages = [];
  global.fetch = async (rawUrl, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    const url = new URL(rawUrl);
    assert.equal(url.searchParams.get("key"), "test-key");
    if (url.pathname.endsWith("/playlists")) return json({ items: [{ snippet: { title: "My playlist" } }] });
    if (url.pathname.endsWith("/playlistItems")) {
      pages.push(url.searchParams.get("pageToken"));
      assert.equal(url.searchParams.get("maxResults"), "50");
      return json(url.searchParams.has("pageToken")
        ? { items: [entry(ids[50]), entry(ids[0]), entry("deleted"), entry("private"), entry("rejected"), {}] }
        : { items: ids.slice(0, 50).map(entry), nextPageToken: "second-page" });
    }
    if (url.pathname.endsWith("/videos")) {
      const requestedIds = url.searchParams.get("id").split(",");
      batches.push(requestedIds);
      return json({ items: requestedIds.filter(id => id !== "deleted").reverse().map(id => ({
        ...video(id), status: {
          privacyStatus: id === "private" ? "private" : "unlisted",
          uploadStatus: id === "rejected" ? "rejected" : "processed",
          // Videos that need the existing OBS fallback are still valid imports.
          embeddable: false
        }
      })) });
    }
    assert.fail(`Unexpected path: ${url.pathname}`);
  };
  t.after(() => { global.fetch = originalFetch; });
  const result = await resolveYouTubePlaylistFromApi(playlistUrl, "test-key");
  assert.deepEqual(pages, [null, "second-page"]);
  assert.deepEqual(batches.map(batch => batch.length), [50, 4]);
  assert.deepEqual(result.tracks.map(track => track.key), ids.map(id => `youtube:${id}`));
  assert.equal(result.trackCount, 56);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.skippedCount, 4);
  assert.equal(result.tracks[0].durationSeconds, 180);
  assert.equal(result.tracks[0].url, "https://www.youtube.com/watch?v=video-0");
});

test("playlist import reports inaccessible, empty and failed imports without exposing API credentials", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  for (const [reason, status, expected] of [
    ["playlistNotFound", 404, /not found/],
    ["playlistItemsNotAccessible", 403, /cannot be imported/],
    ["playlistOperationUnsupported", 400, /YouTube Mix/],
    ["quotaExceeded", 403, /quota exceeded/],
    ["keyInvalid", 400, /API key in Settings/]
  ]) {
    global.fetch = async () => json({ error: { message: "private-api-key", errors: [{ reason }] } }, status);
    await assert.rejects(resolveYouTubePlaylistFromApi(playlistUrl, "private-api-key"), error => {
      assert.match(error.message, expected);
      assert.equal(error.message.includes("private-api-key"), false);
      return true;
    });
  }
  global.fetch = async () => { throw new DOMException("Timed out", "TimeoutError"); };
  await assert.rejects(resolveYouTubePlaylistFromApi(playlistUrl, "test-key"), /connection/);
  global.fetch = async () => json({ items: [] });
  await assert.rejects(resolveYouTubePlaylistFromApi(playlistUrl, "test-key"), /does not contain/);
  global.fetch = async rawUrl => json({ items: new URL(rawUrl).pathname.endsWith("/playlistItems") ? [entry("deleted")] : [] });
  await assert.rejects(resolveYouTubePlaylistFromApi(playlistUrl, "test-key"), /available videos/);
  global.fetch = async () => json({ items: [entry("one")], nextPageToken: "same-page" });
  await assert.rejects(resolveYouTubePlaylistFromApi(playlistUrl, "test-key"), /repeated a playlist page/);
});

test("HTTP import appends durably, is repeatable and leaves playback and the library intact on upstream failure", async (t) => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsrp-youtube-import-"));
  const originalFetch = global.fetch;
  let appServer;
  let failSecondPage = false;
  t.after(async () => {
    await appServer?.close();
    global.fetch = originalFetch;
    await fs.rm(runtimeDir, { recursive: true, force: true, maxRetries: 5 });
  });
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  await fs.writeFile(path.join(runtimeDir, "playlist.csv"), "Link,Title\nhttps://youtu.be/existing,My custom title\n");
  await fs.writeFile(path.join(runtimeDir, "settings.json"), JSON.stringify({ port, youtubeApiKey: "test-key" }));
  const configStore = createConfigStore({
    rootDir: runtimeDir, runtimeDir,
    publicDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public")
  });
  configStore.loadEnvSettings = () => ({});
  global.fetch = async (rawUrl, options) => {
    const url = new URL(rawUrl);
    if (url.hostname === "127.0.0.1" && url.port === String(port)) return originalFetch(rawUrl, options);
    assert.equal(url.hostname, "www.googleapis.com", "The isolated server must not call other services.");
    if (url.pathname.endsWith("/playlists")) return json({ items: [{ snippet: { title: "Import test" } }] });
    if (url.pathname.endsWith("/playlistItems")) {
      if (url.searchParams.has("pageToken")) {
        return failSecondPage ? json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403)
          : json({ items: [entry("new"), entry("deleted")] });
      }
      return json({ items: [entry("existing"), entry("new")], nextPageToken: "next" });
    }
    if (url.pathname.endsWith("/videos")) return json({ items: [video("new"), video("existing")] });
    assert.fail(`Unexpected path: ${url.pathname}`);
  };
  appServer = await startAppServer({ noBrowser: true, configStore });
  const endpoint = new URL("/api/playlist/import-youtube", appServer.urls.dashboardUrl);
  const read = async route => (await originalFetch(new URL(route, endpoint))).json();
  const post = async url => {
    const response = await originalFetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url })
    });
    return { status: response.status, body: await response.json() };
  };
  const stateBefore = await read("/api/state");
  const first = await post("https://youtu.be/existing?list=PLimport");
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, {
    title: "Import test", addedCount: 1, duplicateCount: 2, skippedCount: 1, totalCount: 4, finalCount: 2
  });
  const csv = await fs.readFile(path.join(runtimeDir, "playlist.csv"), "utf8");
  assert.match(csv, /My custom title/);
  assert.match(csv, /Artist - Song new/);
  assert.doesNotMatch(csv, /deleted/);
  const repeated = await post(playlistUrl);
  assert.equal(repeated.body.addedCount, 0);
  assert.equal(repeated.body.duplicateCount, 3);
  assert.equal(repeated.body.finalCount, 2);
  failSecondPage = true;
  const failed = await post(playlistUrl);
  assert.equal(failed.status, 400);
  assert.match(failed.body.error, /quota exceeded/);
  assert.equal(await fs.readFile(path.join(runtimeDir, "playlist.csv"), "utf8"), csv);
  assert.equal((await post("https://soundcloud.com/test/track")).status, 400);
  const stateAfter = await read("/api/state");
  for (const field of ["currentTrack", "queue", "history", "playbackStatus"]) {
    assert.deepEqual(stateAfter[field], stateBefore[field], field);
  }
});
