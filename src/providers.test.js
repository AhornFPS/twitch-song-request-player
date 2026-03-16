import assert from "node:assert/strict";
import test from "node:test";
import { resolveTrackFromUrl } from "./providers.js";

test("soundcloud profile URLs are rejected before metadata lookup", async (t) => {
  const originalFetch = global.fetch;
  let fetchCalled = false;

  global.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called for profile URLs");
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  await assert.rejects(
    () => resolveTrackFromUrl("https://soundcloud.com/aftergenerationholland"),
    /SoundCloud channel URLs are not playable/
  );
  assert.equal(fetchCalled, false);
});
