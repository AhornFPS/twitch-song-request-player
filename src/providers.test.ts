// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import {
  findYouTubeRadioTracks,
  resolveSongRequest,
  resolveTrackFromUrl,
  resolveYouTubePlaylistFromApi,
  resolveYouTubeTrackFromApi
} from "./providers.js";

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
  assert.equal(track.title, "Refresh Channel - Refreshed Title");
  assert.equal(track.key, "youtube:dQw4w9WgXcQ");
  assert.equal(track.artworkUrl, "https://img.youtube.test/high.jpg");
  assert.equal(track.durationSeconds, 242);
  assert.equal(track.sourceChannelId, "UCrefresh");
  assert.equal(track.sourceName, "Refresh Channel");
  assert.equal(track.isLive, false);
});

test("youtube playlist api resolver imports every playlist item across pages", async (t) => {
  const originalFetch = global.fetch;
  const requestedUrls = [];

  global.fetch = async (url) => {
    const requestedUrl = new URL(url);
    requestedUrls.push(requestedUrl);

    if (requestedUrl.pathname === "/youtube/v3/playlists") {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                snippet: {
                  title: "Imported Playlist"
                }
              }
            ]
          };
        }
      };
    }

    if (requestedUrl.pathname === "/youtube/v3/playlistItems") {
      const pageToken = requestedUrl.searchParams.get("pageToken") || "";

      return {
        ok: true,
        async json() {
          if (!pageToken) {
            return {
              nextPageToken: "page-2",
              items: [
                {
                  snippet: {
                    title: "First Song",
                    videoOwnerChannelId: "UCfirst",
                    videoOwnerChannelTitle: "First Artist",
                    thumbnails: {
                      high: {
                        url: "https://img.youtube.test/first.jpg"
                      }
                    }
                  },
                  contentDetails: {
                    videoId: "first123"
                  }
                }
              ]
            };
          }

          return {
            items: [
              {
                snippet: {
                  title: "Second Song",
                  videoOwnerChannelId: "UCsecond",
                  videoOwnerChannelTitle: "Second Artist"
                },
                contentDetails: {
                  videoId: "second456"
                }
              }
            ]
          };
        }
      };
    }

    if (requestedUrl.pathname === "/youtube/v3/videos") {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: "first123",
                snippet: {
                  title: "First Song",
                  channelId: "UCfirst",
                  channelTitle: "First Artist",
                  liveBroadcastContent: "none",
                  thumbnails: {
                    high: {
                      url: "https://img.youtube.test/first-detail.jpg"
                    }
                  }
                },
                contentDetails: {
                  duration: "PT3M4S"
                }
              },
              {
                id: "second456",
                snippet: {
                  title: "Second Song",
                  channelId: "UCsecond",
                  channelTitle: "Second Artist",
                  liveBroadcastContent: "none",
                  thumbnails: {
                    high: {
                      url: "https://img.youtube.test/second-detail.jpg"
                    }
                  }
                },
                contentDetails: {
                  duration: "PT2M30S"
                }
              }
            ]
          };
        }
      };
    }

    throw new Error(`unexpected fetch ${requestedUrl.toString()}`);
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const result = await resolveYouTubePlaylistFromApi(
    "https://www.youtube.com/playlist?list=PLimport123",
    "api-key"
  );

  assert.equal(requestedUrls[0]?.pathname, "/youtube/v3/playlists");
  assert.equal(requestedUrls[1]?.pathname, "/youtube/v3/playlistItems");
  assert.equal(requestedUrls[2]?.searchParams.get("pageToken"), "page-2");
  assert.equal(result.playlistId, "PLimport123");
  assert.equal(result.title, "Imported Playlist");
  assert.equal(result.trackCount, 2);
  assert.equal(result.tracks.length, 2);
  assert.equal(result.tracks[0].title, "First Artist - First Song");
  assert.equal(result.tracks[1].key, "youtube:second456");
  assert.equal(result.tracks[1].durationSeconds, 150);
});

test("youtube titles that already include an artist separator are left unchanged", async (t) => {
  const originalFetch = global.fetch;

  global.fetch = async () => {
    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              id: "separated123",
              snippet: {
                title: "Known Artist - Final Track",
                channelId: "UCseparated",
                channelTitle: "Uploader Channel",
                liveBroadcastContent: "none",
                thumbnails: {}
              },
              contentDetails: {
                duration: "PT3M"
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

  const track = await resolveYouTubeTrackFromApi("https://youtu.be/separated123", "api-key");

  assert.equal(track.title, "Known Artist - Final Track");
  assert.equal(track.sourceName, "Uploader Channel");
});

test("search-based song requests can be disabled independently from direct links", async () => {
  await assert.rejects(
    () => resolveSongRequest("artist song", "api-key", {
      allowSearchRequests: false
    }),
    /Search-based song requests are disabled/
  );
});

test("youtube radio search skips alternate uploads of the seed song", async (t) => {
  const originalFetch = global.fetch;
  let searchRequestCount = 0;

  global.fetch = async (url) => {
    const requestedUrl = new URL(url);

    if (requestedUrl.pathname === "/youtube/v3/search") {
      searchRequestCount += 1;

      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: {
                  videoId: "another-time-live"
                },
                snippet: {
                  title: "Cat Clyde - Another Time (Live Video)",
                  channelTitle: "Cat Clyde",
                  channelId: "UCcat",
                  thumbnails: {}
                }
              },
              {
                id: {
                  videoId: "goodnight-lovers"
                },
                snippet: {
                  title: "Cat Clyde - Goodnight Lovers",
                  channelTitle: "Cat Clyde",
                  channelId: "UCcat",
                  thumbnails: {}
                }
              },
              {
                id: {
                  videoId: "another-time-session"
                },
                snippet: {
                  title: "Cat Clyde - 'Another Time' live session #newsong #indiefolk",
                  channelTitle: "Cat Clyde",
                  channelId: "UCcat",
                  thumbnails: {}
                }
              },
              {
                id: {
                  videoId: "find-you-out"
                },
                snippet: {
                  title: "Cat Clyde - Find You Out",
                  channelTitle: "Cat Clyde",
                  channelId: "UCcat",
                  thumbnails: {}
                }
              }
            ]
          };
        }
      };
    }

    if (requestedUrl.pathname === "/youtube/v3/videos") {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: "another-time-live",
                snippet: {
                  title: "Cat Clyde - Another Time (Live Video)",
                  channelId: "UCcat",
                  channelTitle: "Cat Clyde",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT3M"
                }
              },
              {
                id: "goodnight-lovers",
                snippet: {
                  title: "Cat Clyde - Goodnight Lovers",
                  channelId: "UCcat",
                  channelTitle: "Cat Clyde",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT3M"
                }
              },
              {
                id: "another-time-session",
                snippet: {
                  title: "Cat Clyde - 'Another Time' live session #newsong #indiefolk",
                  channelId: "UCcat",
                  channelTitle: "Cat Clyde",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT3M"
                }
              },
              {
                id: "find-you-out",
                snippet: {
                  title: "Cat Clyde - Find You Out",
                  channelId: "UCcat",
                  channelTitle: "Cat Clyde",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT3M"
                }
              }
            ]
          };
        }
      };
    }

    throw new Error(`unexpected fetch ${requestedUrl.toString()}`);
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const tracks = await findYouTubeRadioTracks({
    provider: "youtube",
    url: "https://youtu.be/another-time-seed",
    title: "Cat Clyde - Another Time (Official Audio)",
    key: "youtube:another-time-seed",
    sourceName: "Cat Clyde"
  }, "api-key", {
    limit: 2
  });

  assert.equal(searchRequestCount >= 1, true);
  assert.deepEqual(
    tracks.map((track) => track.title),
    ["Cat Clyde - Goodnight Lovers", "Cat Clyde - Find You Out"]
  );
});

test("youtube radio search skips repeated song titles from different artists and uploader prefixes", async (t) => {
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const requestedUrl = new URL(url);

    if (requestedUrl.pathname === "/youtube/v3/search") {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: {
                  videoId: "gentle-remastered"
                },
                snippet: {
                  title: "Gentle On My Mind (Remastered 2001)",
                  channelTitle: "Glen Campbell - Topic",
                  channelId: "UCglen-topic",
                  thumbnails: {}
                }
              },
              {
                id: {
                  videoId: "rhinestone"
                },
                snippet: {
                  title: "Rhinestone Cowboy",
                  channelTitle: "Glen Campbell - Topic",
                  channelId: "UCglen-topic",
                  thumbnails: {}
                }
              },
              {
                id: {
                  videoId: "gentle-live"
                },
                snippet: {
                  title: "Glen Campbell Sings \"Gentle On My Mind\" (Original Live)",
                  channelTitle: "BringBackMyYesterday",
                  channelId: "UCarchive",
                  thumbnails: {}
                }
              },
              {
                id: {
                  videoId: "wichita"
                },
                snippet: {
                  title: "Wichita Lineman",
                  channelTitle: "Glen Campbell - Topic",
                  channelId: "UCglen-topic",
                  thumbnails: {}
                }
              }
            ]
          };
        }
      };
    }

    if (requestedUrl.pathname === "/youtube/v3/videos") {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: "gentle-remastered",
                snippet: {
                  title: "Gentle On My Mind (Remastered 2001)",
                  channelId: "UCglen-topic",
                  channelTitle: "Glen Campbell - Topic",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT3M"
                }
              },
              {
                id: "rhinestone",
                snippet: {
                  title: "Rhinestone Cowboy",
                  channelId: "UCglen-topic",
                  channelTitle: "Glen Campbell - Topic",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT3M"
                }
              },
              {
                id: "gentle-live",
                snippet: {
                  title: "Glen Campbell Sings \"Gentle On My Mind\" (Original Live)",
                  channelId: "UCarchive",
                  channelTitle: "BringBackMyYesterday",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT3M"
                }
              },
              {
                id: "wichita",
                snippet: {
                  title: "Wichita Lineman",
                  channelId: "UCglen-topic",
                  channelTitle: "Glen Campbell - Topic",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT3M"
                }
              }
            ]
          };
        }
      };
    }

    if (requestedUrl.hostname === "www.youtube.com" && requestedUrl.pathname.startsWith("/shorts/")) {
      const videoId = requestedUrl.pathname.split("/").filter(Boolean).at(-1);

      return {
        ok: true,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        async text() {
          return "";
        }
      };
    }

    throw new Error(`unexpected fetch ${requestedUrl.toString()}`);
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const tracks = await findYouTubeRadioTracks({
    provider: "youtube",
    url: "https://youtu.be/gentle-seed",
    title: "Bobbie Gentry - Topic - Gentle On My Mind",
    key: "youtube:gentle-seed",
    sourceName: "Bobbie Gentry - Topic"
  }, "api-key", {
    limit: 2
  });

  assert.deepEqual(
    tracks.map((track) => track.title),
    ["Glen Campbell - Topic - Rhinestone Cowboy", "Glen Campbell - Topic - Wichita Lineman"]
  );
});

test("youtube radio search skips renamed uploads of the same song when the title only changes by version text", async (t) => {
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const requestedUrl = new URL(url);

    if (requestedUrl.pathname === "/youtube/v3/search") {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: {
                  videoId: "hotel-live"
                },
                snippet: {
                  title: "Hotel California (Live on MTV, 1994)",
                  channelTitle: "Eagles",
                  channelId: "UCeagles",
                  thumbnails: {}
                }
              },
              {
                id: {
                  videoId: "new-kid"
                },
                snippet: {
                  title: "Eagles - New Kid In Town",
                  channelTitle: "Eagles",
                  channelId: "UCeagles",
                  thumbnails: {}
                }
              },
              {
                id: {
                  videoId: "hotel-rhino"
                },
                snippet: {
                  title: "Hotel California [Official Music Video]",
                  channelTitle: "RHINO",
                  channelId: "UCrhino",
                  thumbnails: {}
                }
              },
              {
                id: {
                  videoId: "one-of-these-nights"
                },
                snippet: {
                  title: "Eagles - One of These Nights",
                  channelTitle: "Eagles",
                  channelId: "UCeagles",
                  thumbnails: {}
                }
              }
            ]
          };
        }
      };
    }

    if (requestedUrl.pathname === "/youtube/v3/videos") {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: "hotel-live",
                snippet: {
                  title: "Hotel California (Live on MTV, 1994)",
                  channelId: "UCeagles",
                  channelTitle: "Eagles",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT6M"
                }
              },
              {
                id: "new-kid",
                snippet: {
                  title: "Eagles - New Kid In Town",
                  channelId: "UCeagles",
                  channelTitle: "Eagles",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT5M"
                }
              },
              {
                id: "hotel-rhino",
                snippet: {
                  title: "Hotel California [Official Music Video]",
                  channelId: "UCrhino",
                  channelTitle: "RHINO",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT6M"
                }
              },
              {
                id: "one-of-these-nights",
                snippet: {
                  title: "Eagles - One of These Nights",
                  channelId: "UCeagles",
                  channelTitle: "Eagles",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT5M"
                }
              }
            ]
          };
        }
      };
    }

    throw new Error(`unexpected fetch ${requestedUrl.toString()}`);
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const tracks = await findYouTubeRadioTracks({
    provider: "youtube",
    url: "https://youtu.be/hotel-seed",
    title: "Eagles - Hotel California",
    key: "youtube:hotel-seed",
    sourceName: "Eagles"
  }, "api-key", {
    limit: 2
  });

  assert.deepEqual(
    tracks.map((track) => track.title),
    ["Eagles - New Kid In Town", "Eagles - One of These Nights"]
  );
});

test("youtube radio search skips YouTube Shorts results", async (t) => {
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const requestedUrl = new URL(url);

    if (requestedUrl.pathname === "/youtube/v3/search") {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: {
                  videoId: "short-track"
                },
                snippet: {
                  title: "Artist - Tiny Song",
                  channelTitle: "Artist",
                  channelId: "UCartist",
                  thumbnails: {}
                }
              },
              {
                id: {
                  videoId: "full-track"
                },
                snippet: {
                  title: "Artist - Full Song One",
                  channelTitle: "Artist",
                  channelId: "UCartist",
                  thumbnails: {}
                }
              },
              {
                id: {
                  videoId: "full-track-two"
                },
                snippet: {
                  title: "Artist - Full Song Two",
                  channelTitle: "Artist",
                  channelId: "UCartist",
                  thumbnails: {}
                }
              }
            ]
          };
        }
      };
    }

    if (requestedUrl.pathname === "/youtube/v3/videos") {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: "short-track",
                snippet: {
                  title: "Artist - Tiny Song",
                  channelId: "UCartist",
                  channelTitle: "Artist",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT45S"
                }
              },
              {
                id: "full-track",
                snippet: {
                  title: "Artist - Full Song One",
                  channelId: "UCartist",
                  channelTitle: "Artist",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT4M"
                }
              },
              {
                id: "full-track-two",
                snippet: {
                  title: "Artist - Full Song Two",
                  channelId: "UCartist",
                  channelTitle: "Artist",
                  liveBroadcastContent: "none",
                  thumbnails: {}
                },
                contentDetails: {
                  duration: "PT4M10S"
                }
              }
            ]
          };
        }
      };
    }

    if (requestedUrl.hostname === "www.youtube.com" && requestedUrl.pathname === "/shorts/short-track") {
      return {
        ok: true,
        url: requestedUrl.toString(),
        async text() {
          return "";
        }
      };
    }

    if (requestedUrl.hostname === "www.youtube.com" && requestedUrl.pathname.startsWith("/shorts/")) {
      const videoId = requestedUrl.pathname.split("/").filter(Boolean).at(-1);

      return {
        ok: true,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        async text() {
          return "";
        }
      };
    }

    throw new Error(`unexpected fetch ${requestedUrl.toString()}`);
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const tracks = await findYouTubeRadioTracks({
    provider: "youtube",
    url: "https://youtu.be/seed-song",
    title: "Artist - Seed Song",
    key: "youtube:seed-song",
    sourceName: "Artist"
  }, "api-key", {
    limit: 2
  });

  assert.deepEqual(
    tracks.map((track) => track.title),
    ["Artist - Full Song One", "Artist - Full Song Two"]
  );
});

test("spotify track links resolve into playable YouTube tracks using Spotify metadata", async (t) => {
  const originalFetch = global.fetch;
  const requestedUrls = [];

  global.fetch = async (url) => {
    const requestedUrl = new URL(url);
    requestedUrls.push(requestedUrl);

    if (requestedUrl.origin === "https://open.spotify.com") {
      return {
        ok: true,
        url: requestedUrl.toString(),
        async text() {
          return [
            "<html><head>",
            '<link rel="canonical" href="https://open.spotify.com/track/spotify123" />',
            '<meta property="og:title" content="Cut To The Feeling" />',
            '<meta property="og:description" content="Carly Rae Jepsen · Cut To The Feeling · Song · 2017" />',
            '<meta property="og:image" content="https://image.spotify.test/cut.jpg" />',
            '<meta name="music:musician_description" content="Carly Rae Jepsen" />',
            '<meta name="music:duration" content="208" />',
            "</head><body></body></html>"
          ].join("");
        }
      };
    }

    if (requestedUrl.pathname === "/youtube/v3/search") {
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: {
                  videoId: "spotify-result"
                },
                snippet: {
                  title: "Cut To The Feeling",
                  thumbnails: {
                    high: {
                      url: "https://img.youtube.test/spotify-search.jpg"
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
              id: "spotify-result",
              snippet: {
                title: "Cut To The Feeling",
                channelId: "UCspotify",
                channelTitle: "Carly Rae Jepsen",
                liveBroadcastContent: "none",
                thumbnails: {
                  high: {
                    url: "https://img.youtube.test/spotify-result.jpg"
                  }
                }
              },
              contentDetails: {
                duration: "PT3M27S"
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

  const track = await resolveSongRequest("https://open.spotify.com/track/spotify123", "api-key", {
    youtubeSafeSearch: "strict"
  });

  assert.equal(requestedUrls[1]?.pathname, "/youtube/v3/search");
  assert.equal(requestedUrls[1]?.searchParams.get("q"), "Carly Rae Jepsen - Cut To The Feeling");
  assert.equal(requestedUrls[1]?.searchParams.get("safeSearch"), "strict");
  assert.equal(track.provider, "youtube");
  assert.equal(track.key, "youtube:spotify-result");
  assert.equal(track.requestedFromProvider, "spotify");
  assert.equal(track.requestedFromUrl, "https://open.spotify.com/track/spotify123");
  assert.equal(track.requestedFromTitle, "Cut To The Feeling");
  assert.equal(track.requestedFromName, "Carly Rae Jepsen");
});

test("suno song links resolve into playable Suno tracks using Suno metadata", async (t) => {
  const originalFetch = global.fetch;
  const requestedUrls = [];

  global.fetch = async (url) => {
    const requestedUrl = new URL(url);
    requestedUrls.push(requestedUrl);

    if (requestedUrl.origin === "https://suno.com") {
      return {
        ok: true,
        url: requestedUrl.toString(),
        async text() {
          return [
            "<html><head>",
            '<link rel="canonical" href="https://suno.com/song/suno123" />',
            '<meta property="og:title" content="perdu" />',
            '<meta property="og:image" content="https://cdn2.suno.ai/perdu.jpeg" />',
            '<meta name="description" content="perdu by Khassy (@khassy973). Listen and make your own on Suno." />',
            "</head><body>",
            '<script>self.__next_f.push([1,"2f:[{\\"duration\\":182.68,\\"audio_url\\":\\"https://cdn1.suno.ai/suno123.mp3\\"}]"])</script>',
            "</body></html>"
          ].join("");
        }
      };
    }

    throw new Error(`unexpected fetch ${requestedUrl.toString()}`);
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const track = await resolveSongRequest("https://suno.com/song/suno123", "api-key");

  assert.equal(requestedUrls.length, 1);
  assert.equal(track.provider, "suno");
  assert.equal(track.key, "suno:suno123");
  assert.equal(track.url, "https://suno.com/song/suno123");
  assert.equal(track.title, "perdu");
  assert.equal(track.sourceName, "Khassy");
  assert.equal(track.durationSeconds, 183);
  assert.equal(track.audioUrl, "https://cdn1.suno.ai/suno123.mp3");
});

test("suno song links do not require YouTube API access to become playable requests", async (t) => {
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    const requestedUrl = new URL(url);

    if (requestedUrl.origin === "https://suno.com") {
      return {
        ok: true,
        url: requestedUrl.toString(),
        async text() {
          return [
            "<html><head>",
            '<link rel="canonical" href="https://suno.com/song/suno456" />',
            '<meta property="og:title" content="Midnight Echo" />',
            '<meta property="og:image" content="https://cdn2.suno.ai/midnight.jpeg" />',
            '<meta name="description" content="Midnight Echo by ExampleArtist (@exampleartist). Listen and make your own on Suno." />',
            '</head><body><script>self.__next_f.push([1,"2f:[{\\"audio_url\\":\\"https://cdn1.suno.ai/suno456.mp3\\",\\"duration\\":201}]"])</script></body></html>'
          ].join("");
        }
      };
    }

    throw new Error(`unexpected fetch ${requestedUrl.toString()}`);
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const track = await resolveSongRequest("https://suno.com/song/suno456", "");

  assert.equal(track.provider, "suno");
  assert.equal(track.audioUrl, "https://cdn1.suno.ai/suno456.mp3");
  assert.equal(track.durationSeconds, 201);
});

test("spotify links require YouTube API access to become playable requests", async (t) => {
  const originalFetch = global.fetch;

  global.fetch = async () => {
    return {
      ok: true,
      url: "https://open.spotify.com/track/spotify123",
      async text() {
        return [
          "<html><head>",
          '<link rel="canonical" href="https://open.spotify.com/track/spotify123" />',
          '<meta property="og:title" content="Cut To The Feeling" />',
          '<meta property="og:description" content="Carly Rae Jepsen · Cut To The Feeling · Song · 2017" />',
          '<meta name="music:musician_description" content="Carly Rae Jepsen" />',
          "</head><body></body></html>"
        ].join("");
      }
    };
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  await assert.rejects(
    () => resolveSongRequest("https://open.spotify.com/track/spotify123", ""),
    /Spotify requests require YOUTUBE_API_KEY/
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
  assert.equal(track.title, "Safe Channel - Safe Result");
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
  assert.equal(track.title, "Direct Channel - Enriched Direct Track");
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
  assert.equal(track.title, "Example Channel - OEmbed Track");
  assert.equal(track.sourceName, "Example Channel");
  assert.equal(track.sourceUrl, "https://www.youtube.com/@examplechannel");
  assert.equal(track.sourceChannelId, "");
});
