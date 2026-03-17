import assert from "node:assert/strict";
import test from "node:test";
import { resolveSongRequest, resolveTrackFromUrl, resolveYouTubeTrackFromApi } from "./providers.js";

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

test("youtube api metadata resolver refreshes an existing video URL", async (t) => {
  const originalFetch = global.fetch;
  let requestedUrl = null;

  global.fetch = async (url) => {
    requestedUrl = new URL(url);

    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              id: "dQw4w9WgXcQ",
              snippet: {
                title: " Refreshed Title ",
                thumbnails: {
                  high: {
                    url: "https://img.youtube.test/high.jpg"
                  }
                }
              }
            }
          ]
        };
      }
    };
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const track = await resolveYouTubeTrackFromApi("https://youtu.be/dQw4w9WgXcQ?t=42", "api-key");

  assert.equal(requestedUrl?.origin, "https://www.googleapis.com");
  assert.equal(requestedUrl?.pathname, "/youtube/v3/videos");
  assert.equal(requestedUrl?.searchParams.get("part"), "snippet");
  assert.equal(requestedUrl?.searchParams.get("id"), "dQw4w9WgXcQ");
  assert.equal(requestedUrl?.searchParams.get("key"), "api-key");
  assert.equal(track.provider, "youtube");
  assert.equal(track.url, "https://youtu.be/dQw4w9WgXcQ?t=42");
  assert.equal(track.title, "Refreshed Title");
  assert.equal(track.key, "youtube:dQw4w9WgXcQ");
  assert.equal(track.artworkUrl, "https://img.youtube.test/high.jpg");
});

test("search-based song requests can be disabled independently from direct links", async () => {
  await assert.rejects(
    () => resolveSongRequest("artist song", "api-key", {
      allowSearchRequests: false
    }),
    /Search-based song requests are disabled/
  );
});

test("youtube search requests honor the configured safe search mode", async (t) => {
  const originalFetch = global.fetch;
  let requestedUrl = null;

  global.fetch = async (url) => {
    requestedUrl = new URL(url);

    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              id: {
                videoId: "safe123"
              },
              snippet: {
                title: "Safe Result",
                thumbnails: {
                  high: {
                    url: "https://img.youtube.test/safe.jpg"
                  }
                }
              }
            }
          ]
        };
      }
    };
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const track = await resolveSongRequest("safe song", "api-key", {
    allowSearchRequests: true,
    youtubeSafeSearch: "strict"
  });

  assert.equal(requestedUrl?.searchParams.get("safeSearch"), "strict");
  assert.equal(track.title, "Safe Result");
  assert.equal(track.key, "youtube:safe123");
});
