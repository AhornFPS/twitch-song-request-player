// @ts-nocheck
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

test("youtube api metadata resolver refreshes an existing video URL with channel and duration metadata", async (t) => {
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
                channelId: "UCrefresh",
                channelTitle: "Refresh Channel",
                liveBroadcastContent: "none",
                thumbnails: {
                  high: {
                    url: "https://img.youtube.test/high.jpg"
                  }
                }
              },
              contentDetails: {
                duration: "PT4M2S"
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
  assert.equal(requestedUrl?.searchParams.get("part"), "snippet,contentDetails,liveStreamingDetails");
  assert.equal(requestedUrl?.searchParams.get("id"), "dQw4w9WgXcQ");
  assert.equal(requestedUrl?.searchParams.get("key"), "api-key");
  assert.equal(track.provider, "youtube");
  assert.equal(track.url, "https://youtu.be/dQw4w9WgXcQ?t=42");
  assert.equal(track.title, "Refreshed Title");
  assert.equal(track.key, "youtube:dQw4w9WgXcQ");
  assert.equal(track.artworkUrl, "https://img.youtube.test/high.jpg");
  assert.equal(track.durationSeconds, 242);
  assert.equal(track.sourceChannelId, "UCrefresh");
  assert.equal(track.sourceName, "Refresh Channel");
  assert.equal(track.isLive, false);
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
  const requestedUrls = [];

  global.fetch = async (url) => {
    const requestedUrl = new URL(url);
    requestedUrls.push(requestedUrl);

    if (requestedUrl.pathname === "/youtube/v3/search") {
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
    }

    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              id: "safe123",
              snippet: {
                title: "Safe Result",
                channelId: "UCsafe",
                channelTitle: "Safe Channel",
                liveBroadcastContent: "none",
                thumbnails: {
                  high: {
                    url: "https://img.youtube.test/safe.jpg"
                  }
                }
              },
              contentDetails: {
                duration: "PT3M5S"
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

  assert.equal(requestedUrls[0]?.searchParams.get("safeSearch"), "strict");
  assert.equal(track.title, "Safe Result");
  assert.equal(track.key, "youtube:safe123");
  assert.equal(track.durationSeconds, 185);
  assert.equal(track.sourceChannelId, "UCsafe");
});

test("direct YouTube chat requests can opt into API metadata enrichment", async (t) => {
  const originalFetch = global.fetch;
  const requestedUrls = [];

  global.fetch = async (url) => {
    const requestedUrl = new URL(url);
    requestedUrls.push(requestedUrl);

    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              id: "enriched123",
              snippet: {
                title: "Enriched Direct Track",
                channelId: "UCenriched",
                channelTitle: "Direct Channel",
                liveBroadcastContent: "live",
                thumbnails: {
                  high: {
                    url: "https://img.youtube.test/enriched.jpg"
                  }
                }
              },
              contentDetails: {
                duration: "PT1H2M3S"
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

  const track = await resolveSongRequest("https://youtu.be/enriched123", "api-key", {
    preferYouTubeApiMetadata: true
  });

  assert.equal(requestedUrls[0]?.pathname, "/youtube/v3/videos");
  assert.equal(track.sourceChannelId, "UCenriched");
  assert.equal(track.durationSeconds, 3723);
  assert.equal(track.isLive, true);
});

test("direct YouTube links without API metadata still capture channel details from oEmbed", async (t) => {
  const originalFetch = global.fetch;
  let requestedUrl = null;

  global.fetch = async (url) => {
    requestedUrl = new URL(url);

    return {
      ok: true,
      async json() {
        return {
          title: "OEmbed Track",
          author_name: "Example Channel",
          author_url: "https://www.youtube.com/@examplechannel",
          thumbnail_url: "https://img.youtube.test/oembed.jpg"
        };
      }
    };
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const track = await resolveTrackFromUrl("https://www.youtube.com/watch?v=oembed123");

  assert.equal(requestedUrl?.origin, "https://www.youtube.com");
  assert.equal(requestedUrl?.pathname, "/oembed");
  assert.equal(track.title, "OEmbed Track");
  assert.equal(track.sourceName, "Example Channel");
  assert.equal(track.sourceUrl, "https://www.youtube.com/@examplechannel");
  assert.equal(track.sourceChannelId, "");
});
