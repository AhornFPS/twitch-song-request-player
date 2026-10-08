// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../client/dashboard.ts", import.meta.url), "utf8");
const start = source.indexOf("async function startFreshLibrary(");
const end = source.indexOf("async function bulkDeletePlaylistTracks(", start);
assert.ok(start >= 0 && end > start);

function createDashboard(confirm, fetchJson) {
  const button = { disabled: false, textContent: "Start fresh library" };
  const feedback = [];
  const context = vm.createContext({
    window: { confirm },
    fetchJson,
    playlistResetPending: false,
    playlistSelectedKeys: new Set(["selected-track"]),
    playlistQuery: "filtered title",
    playlistPage: 2,
    playlistSearchDebounceTimer: null,
    clearTimeout,
    el: () => button,
    loadPlaylist: async () => {},
    setPlaylistFeedback: (message, tone) => feedback.push({ message, tone })
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, button, feedback };
}

test("cancelling a fresh library leaves saved tracks and the current view alone", async () => {
  let requests = 0;
  const { context, button, feedback } = createDashboard(() => false, async () => requests++);
  await context.startFreshLibrary();
  assert.equal(requests, 0);
  assert.equal(context.playlistSelectedKeys.has("selected-track"), true);
  assert.equal(context.playlistQuery, "filtered title");
  assert.equal(context.playlistPage, 2);
  assert.equal(button.disabled, false);
  assert.equal(feedback.length, 0);
});

test("a failed fresh-library request retains the view and allows retry", async () => {
  const { context, button, feedback } = createDashboard(() => true, async () => {
    throw new Error("Library is unavailable");
  });
  await context.startFreshLibrary();
  assert.equal(context.playlistSelectedKeys.has("selected-track"), true);
  assert.equal(context.playlistQuery, "filtered title");
  assert.equal(context.playlistPage, 2);
  assert.equal(context.playlistResetPending, false);
  assert.equal(button.disabled, false);
  assert.deepEqual(feedback, [{ message: "Library is unavailable", tone: "error" }]);
});
