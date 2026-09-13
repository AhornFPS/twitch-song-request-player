// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { ObsYoutubeFallback } from "./obs-youtube-fallback.js";

function createFakeObsClient(calls) {
  return {
    async connect(url, password) {
      calls.push({
        type: "connect",
        url,
        password
      });
    },
    async call(requestType, requestPayload) {
      calls.push({
        type: "call",
        requestType,
        requestPayload
      });
    },
    async disconnect() {
      calls.push({
        type: "disconnect"
      });
    }
  };
}

test("duplicate fallback starts share one URL load and keep the original finish timer", async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fallback = new ObsYoutubeFallback({
    getSettings: () => ({obsYoutubeFallbackEnabled:true,obsYoutubeFallbackSourceName:"YouTube Fallback"}),
    createClient: () => ({...createFakeObsClient(calls), async connect(){await gate;}})
  });
  const track={id:"same-request",provider:"youtube",url:"https://youtu.be/duplicate",durationSeconds:180};
  const first=fallback.startTrack(track);
  const second=fallback.startTrack(track);
  release();
  await Promise.all([first,second]);
  const timer=fallback.finishTimer;
  await fallback.startTrack(track);
  assert.equal(calls.filter(c=>c.requestType === "SetInputSettings").length,1);
  assert.equal(fallback.finishTimer,timer);
  fallback.shutdown();
});

test("skipping during fallback metadata lookup cannot resurrect the old request", async (t) => {
  const calls=[];
  let release;
  const metadata=new Promise(resolve=>{release=resolve;});
  const fallback=new ObsYoutubeFallback({
    getSettings:()=>({obsYoutubeFallbackEnabled:true,obsYoutubeFallbackSourceName:"YouTube Fallback"}),
    createClient:()=>createFakeObsClient(calls),
    resolveTrackMetadata:()=>metadata
  });
  const track={id:"skipped-request",provider:"youtube",url:"https://youtu.be/old-request"};
  t.after(()=>fallback.shutdown());
  const start=fallback.startTrack(track);
  await fallback.stopTrack(track);
  release({durationSeconds:3600});
  await start;
  assert.equal(fallback.activeTrackId,"");
  assert.equal(calls.filter(c=>c.requestType==="SetInputSettings"&&c.requestPayload.inputSettings.url!=="about:blank").length,0);
  fallback.shutdown();
});

test("skip during an in-flight OBS write clears it before the replacement starts", async (t) => {
  const urls=[];
  let releaseWrite;
  let signalWrite;
  const started=new Promise(resolve=>{signalWrite=resolve;});
  const gate=new Promise(resolve=>{releaseWrite=resolve;});
  const fallback=new ObsYoutubeFallback({
    getSettings:()=>({obsYoutubeFallbackEnabled:true,obsYoutubeFallbackSourceName:"YouTube Fallback"}),
    createClient:()=>({async connect(){},async disconnect(){},async call(_type,payload){
      const url=payload.inputSettings.url;
      if(url.includes('old-video')){signalWrite();await gate;}
      urls.push(url);
    }})
  });
  t.after(()=>fallback.shutdown());
  fallback.sourceClearNeeded=false;
  const old={id:"old",provider:"youtube",url:"https://youtu.be/old-video",durationSeconds:180};
  const next={id:"next",provider:"youtube",url:"https://youtu.be/new-video",durationSeconds:180};
  const oldStart=fallback.startTrack(old);
  await started;
  const stop=fallback.stopTrack(old);
  const nextStart=fallback.startTrack(next);
  releaseWrite();
  assert.deepEqual(await oldStart,{cancelled:true});
  await Promise.all([stop,nextStart]);
  assert.equal(urls.length,3);
  assert.match(urls[0],/old-video/);
  assert.equal(urls[1],"about:blank");
  assert.match(urls[2],/new-video/);
  assert.equal(fallback.activeTrackId,"next");
  await fallback.stopTrack(old);
  assert.equal(fallback.activeTrackId,"next","late old stop cannot clear the replacement");
});

test("OBS YouTube fallback opens login page and starts blocked tracks on the configured source", async () => {
  const calls = [];
  const endedEvents = [];
  const fallback = new ObsYoutubeFallback({
    getSettings: () => ({
      obsYoutubeFallbackEnabled: true,
      obsWebSocketUrl: "127.0.0.1:4455",
      obsWebSocketPassword: "secret",
      obsYoutubeFallbackSourceName: "YouTube Fallback"
    }),
    createClient: () => createFakeObsClient(calls),
    playbackBufferSeconds: 0,
    onTrackEnded: async (event) => {
      endedEvents.push(event);
    }
  });

  assert.equal(fallback.isConfigured(), true);
  assert.equal(fallback.canPlayBlockedYouTube({ provider: "youtube" }), true);
  assert.equal(
    fallback.shouldHandlePlayerError(
      { provider: "youtube" },
      { reason: "youtube_150" }
    ),
    true
  );
  assert.equal(
    fallback.shouldHandlePlayerError(
      { provider: "youtube" },
      { reason: "playback_confirmation_timeout" }
    ),
    true
  );

  await fallback.openLoginPage();
  assert.deepEqual(calls.slice(0, 3), [
    {
      type: "connect",
      url: "ws://127.0.0.1:4455",
      password: "secret"
    },
    {
      type: "call",
      requestType: "SetInputSettings",
      requestPayload: {
        inputName: "YouTube Fallback",
        inputSettings: {
          url: "https://www.youtube.com/"
        },
        overlay: true
      }
    },
    {
      type: "disconnect"
    }
  ]);

  await fallback.startTrack({
    id: "track-1",
    provider: "youtube",
    url: "https://music.youtube.com/watch?v=blocked",
    title: "Blocked Track",
    key: "youtube:blocked",
    durationSeconds: 1
  }, {
    reason: "youtube_150"
  });

  const playbackCall = calls.findLast((call) => call.type === "call");
  assert.equal(playbackCall.requestPayload.inputSettings.url, "https://www.youtube.com/watch?v=blocked&autoplay=1");
  assert.equal(fallback.isPlayingTrack({ id: "track-1" }), true);

  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.deepEqual(endedEvents, [
    {
      trackId: "track-1",
      reason: "obs_youtube_fallback_timer"
    }
  ]);
});

test("OBS YouTube fallback keeps the default finish buffer short", () => {
  const fallback = new ObsYoutubeFallback({
    getSettings: () => ({})
  });

  assert.equal(fallback.playbackBufferSeconds, 1);
});

test("OBS YouTube fallback refreshes a missing duration before playback", async () => {
  const calls = [];
  const endedEvents = [];
  const refreshedTracks = [];
  const fallback = new ObsYoutubeFallback({
    getSettings: () => ({
      obsYoutubeFallbackEnabled: true,
      obsWebSocketUrl: "127.0.0.1:4455",
      obsWebSocketPassword: "secret",
      obsYoutubeFallbackSourceName: "YouTube Fallback"
    }),
    createClient: () => createFakeObsClient(calls),
    resolveTrackMetadata: async (track) => {
      refreshedTracks.push(track);
      return {
        durationSeconds: 1
      };
    },
    playbackBufferSeconds: 0,
    onTrackEnded: async (event) => {
      endedEvents.push(event);
    }
  });
  const track = {
    id: "track-without-duration",
    provider: "youtube",
    url: "https://youtu.be/f0I09y6JDUQ",
    title: "Influence",
    key: "youtube:f0I09y6JDUQ"
  };

  const startResult = await fallback.startTrack(track, {
    reason: "youtube_150"
  });

  assert.equal(refreshedTracks.length, 1);
  assert.equal(refreshedTracks[0], track);
  assert.equal(track.durationSeconds, 1);
  assert.deepEqual(startResult, {
    durationSeconds: 1
  });

  const playbackCall = calls.findLast((call) => call.type === "call");
  assert.equal(playbackCall.requestPayload.inputSettings.url, "https://www.youtube.com/watch?v=f0I09y6JDUQ&autoplay=1");

  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.deepEqual(endedEvents, [
    {
      trackId: "track-without-duration",
      reason: "obs_youtube_fallback_timer"
    }
  ]);
});

test("OBS YouTube fallback does not open an unavailable video", async () => {
  const calls = [];
  const fallback = new ObsYoutubeFallback({
    getSettings: () => ({
      obsYoutubeFallbackEnabled: true,
      obsWebSocketUrl: "127.0.0.1:4455",
      obsWebSocketPassword: "secret",
      obsYoutubeFallbackSourceName: "YouTube Fallback"
    }),
    createClient: () => createFakeObsClient(calls),
    resolveTrackMetadata: async () => {
      const error = new Error("No YouTube video metadata found for unavailable123.");
      error.code = "youtube_video_unavailable";
      throw error;
    }
  });

  const startResult = await fallback.startTrack({
    id: "unavailable-track",
    provider: "youtube",
    url: "https://youtu.be/unavailable123",
    title: "https://youtu.be/unavailable123",
    key: "youtube:unavailable123"
  }, {
    reason: "youtube_150"
  });

  assert.deepEqual(startResult, {
    unavailable: true,
    reason: "youtube_video_unavailable",
    message: "No YouTube video metadata found for unavailable123.",
    durationSeconds: null
  });
  assert.equal(fallback.isPlayingTrack({ id: "unavailable-track" }), false);
  const sourceUrls = calls
    .filter((call) => call.type === "call")
    .map((call) => call.requestPayload.inputSettings.url);
  assert.deepEqual(sourceUrls, ["about:blank"]);
});

test("OBS YouTube fallback can clear a stale source without an active in-memory track", async () => {
  const calls = [];
  const fallback = new ObsYoutubeFallback({
    getSettings: () => ({
      obsYoutubeFallbackEnabled: true,
      obsWebSocketUrl: "127.0.0.1:4455",
      obsWebSocketPassword: "secret",
      obsYoutubeFallbackSourceName: "YouTube Fallback"
    }),
    createClient: () => createFakeObsClient(calls)
  });

  assert.equal(fallback.isPlayingTrack({ id: "missing-after-restart" }), false);
  const cleared = await fallback.clearSource({
    reason: "embedded_playback_start"
  });

  assert.equal(cleared, true);
  const clearCall = calls.find((call) => call.type === "call");
  assert.equal(clearCall.requestPayload.inputName, "YouTube Fallback");
  assert.equal(clearCall.requestPayload.inputSettings.url, "about:blank");
});

test("OBS YouTube fallback keeps stale-source cleanup pending until OBS accepts it", async () => {
  let shouldFail = true;
  const calls = [];
  const fallback = new ObsYoutubeFallback({
    getSettings: () => ({
      obsYoutubeFallbackEnabled: true,
      obsWebSocketUrl: "127.0.0.1:4455",
      obsWebSocketPassword: "secret",
      obsYoutubeFallbackSourceName: "YouTube Fallback"
    }),
    createClient: () => ({
      async connect() {
        if (shouldFail) {
          throw new Error("OBS is offline");
        }
      },
      async call(requestType, requestPayload) {
        calls.push({ requestType, requestPayload });
      },
      async disconnect() {
      }
    })
  });

  assert.equal(fallback.needsSourceClear(), true);
  assert.equal(await fallback.clearSource({ reason: "embedded_playback_start" }), false);
  assert.equal(fallback.needsSourceClear(), true);

  shouldFail = false;
  assert.equal(await fallback.clearSource({ reason: "obs_browser_source_connected" }), true);
  assert.equal(fallback.needsSourceClear(), false);
  assert.equal(calls.at(-1)?.requestPayload.inputSettings.url, "about:blank");
});

test("OBS YouTube fallback retries a failed release after its in-memory owner is gone", async () => {
  let connectAttempt = 0;
  let retryCallback = null;
  const calls = [];
  const fallback = new ObsYoutubeFallback({
    getSettings: () => ({
      obsYoutubeFallbackEnabled: true,
      obsWebSocketUrl: "127.0.0.1:4455",
      obsWebSocketPassword: "secret",
      obsYoutubeFallbackSourceName: "YouTube Fallback"
    }),
    createClient: () => ({
      async connect() {
        connectAttempt += 1;
        if (connectAttempt === 1) {
          throw new Error("OBS briefly unavailable");
        }
      },
      async call(requestType, requestPayload) {
        calls.push({ requestType, requestPayload });
      },
      async disconnect() {
      }
    }),
    setTimeoutFn(callback) {
      retryCallback = callback;
      return { unref() {} };
    },
    clearTimeoutFn() {
      retryCallback = null;
    }
  });

  assert.equal(await fallback.stopTrack({ id: "finished-fallback" }), false);
  assert.equal(fallback.isPlayingTrack({ id: "finished-fallback" }), false);
  assert.equal(fallback.needsSourceClear(), true);
  assert.equal(typeof retryCallback, "function");

  retryCallback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fallback.needsSourceClear(), false);
  assert.equal(calls.at(-1)?.requestPayload.inputSettings.url, "about:blank");
});
