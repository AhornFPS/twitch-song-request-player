import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

function createClassList() {
  const values = new Set();
  return {
    add(...tokens) {
      tokens.forEach((token) => values.add(token));
    },
    remove(...tokens) {
      tokens.forEach((token) => values.delete(token));
    },
    contains(token) {
      return values.has(token);
    }
  };
}

function createElement(id = "") {
  const styleValues = new Map();
  const element = {
    id,
    className: "",
    classList: createClassList(),
    children: [],
    style: {
      display: "",
      width: "",
      setProperty(name, value) {
        styleValues.set(name, value);
      },
      getPropertyValue(name) {
        return styleValues.get(name) ?? "";
      },
      removeProperty(name) {
        styleValues.delete(name);
      },
    },
    textContent: "",
    offsetWidth: 0,
    clientWidth: 0,
    scrollWidth: 0,
    getBoundingClientRect() {
      return {
        width: this.offsetWidth || this.clientWidth || 0
      };
    },
    parentNode: {
      replaceChild() {
      }
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeAttribute() {
    }
  };

  let innerHtmlValue = "";
  Object.defineProperty(element, "innerHTML", {
    get() {
      return innerHtmlValue;
    },
    set(value) {
      innerHtmlValue = String(value);
      if (innerHtmlValue === "") {
        this.children = [];
      }
    }
  });

  return element;
}

function createOverlayTestContext() {
  const elements = new Map();
  const sessionStorageData = new Map();
  const locationReplaceCalls = [];
  const windowEventListeners = new Map();
  let requestAnimationFrameCalls = 0;
  const timeoutCalls = [];
  let nextTimerId = 1;

  function getElement(id) {
    if (!elements.has(id)) {
      elements.set(id, createElement(id));
    }

    return elements.get(id);
  }

  const document = {
    documentElement: {
      dataset: {}
    },
    fonts: null,
    getElementById(id) {
      return getElement(id);
    },
    createElement(tagName) {
      return createElement(tagName);
    }
  };

  const window = {
    document,
    navigator: {
      userAgent: "node-test"
    },
    location: {
      href: "http://localhost:3000/overlay",
      origin: "http://localhost:3000",
      replace(url) {
        locationReplaceCalls.push(url);
        this.href = url;
      },
      reload() {
      }
    },
    sessionStorage: {
      getItem(key) {
        return sessionStorageData.has(key) ? sessionStorageData.get(key) : null;
      },
      setItem(key, value) {
        sessionStorageData.set(key, String(value));
      },
      removeItem(key) {
        sessionStorageData.delete(key);
      }
    },
    __playerLog() {
    },
    addEventListener(type, listener) {
      if (!windowEventListeners.has(type)) {
        windowEventListeners.set(type, []);
      }
      windowEventListeners.get(type).push(listener);
    },
    requestAnimationFrame(callback) {
      requestAnimationFrameCalls += 1;
      callback();
      return nextTimerId++;
    },
    cancelAnimationFrame() {
    },
    setTimeout() {
      timeoutCalls.push(Array.from(arguments));
      return nextTimerId++;
    },
    clearTimeout() {
    },
    setInterval() {
      return nextTimerId++;
    },
    clearInterval() {
    }
  };

  const context = {
    URL,
    Date,
    console,
    document,
    fetch() {
      return Promise.resolve({
        ok: true,
        json: async () => ({})
      });
    },
    navigator: window.navigator,
    window
  };

  window.fetch = context.fetch;

  return {
    context,
    locationReplaceCalls,
    sessionStorageData,
    dispatchWindowEvent(type, payload) {
      const listeners = windowEventListeners.get(type) ?? [];
      listeners.forEach((listener) => listener(payload));
    },
    getRequestAnimationFrameCalls() {
      return requestAnimationFrameCalls;
    },
    getTimeoutCalls() {
      return timeoutCalls;
    }
  };
}

test("title marquee retries measurement when the overlay width is not ready yet", () => {
  const appPath = path.resolve("public/app.js");
  const source = fs.readFileSync(appPath, "utf8");
  const { context, getTimeoutCalls } = createOverlayTestContext();

  vm.createContext(context);
  vm.runInContext(source, context, {
    filename: appPath
  });

  const title = context.document.getElementById("current-title");
  const titleText = context.document.getElementById("current-title-text");
  title.clientWidth = 0;
  title.offsetWidth = 0;
  titleText.scrollWidth = 0;
  titleText.offsetWidth = 0;

  context.__state = {
    currentTrack: {
      id: "yt-not-ready",
      provider: "youtube",
      title: "Layout not ready yet",
      url: "https://www.youtube.com/watch?v=notready",
      origin: "playlist"
    },
    queue: []
  };

  vm.runInContext("updateState(__state);", context);

  assert.equal(getTimeoutCalls().length >= 1, true);
  assert.equal(getTimeoutCalls()[0][1], 180);
});

test("overflowing titles still enable marquee when the text width comes from layout bounds", () => {
  const appPath = path.resolve("public/app.js");
  const source = fs.readFileSync(appPath, "utf8");
  const { context } = createOverlayTestContext();

  vm.createContext(context);
  vm.runInContext(source, context, {
    filename: appPath
  });

  const title = context.document.getElementById("current-title");
  const titleText = context.document.getElementById("current-title-text");
  const titleClone = context.document.getElementById("current-title-text-clone");
  title.clientWidth = 140;
  title.offsetWidth = 140;
  titleText.textContent = "A very long track title that should scroll";
  titleText.scrollWidth = 0;
  titleText.offsetWidth = 320;
  titleClone.offsetWidth = 320;

  context.__state = {
    currentTrack: {
      id: "yt-long",
      provider: "youtube",
      title: titleText.textContent,
      url: "https://www.youtube.com/watch?v=abc123",
      origin: "playlist"
    },
    queue: []
  };

  vm.runInContext("updateState(__state);", context);

  assert.equal(title.classList.contains("is-marquee"), true);
  assert.equal(title.style.getPropertyValue("--title-marquee-distance"), "500px");
  assert.equal(title.style.getPropertyValue("--title-marquee-duration"), `${500 / 26}s`);
});

test("overlay marquee keyframes stay continuous through the loop point", () => {
  const stylesPath = path.resolve("public/styles.css");
  const styles = fs.readFileSync(stylesPath, "utf8");
  const keyframesStart = styles.indexOf("@keyframes title-marquee");
  const nextKeyframesStart = styles.indexOf("@keyframes ", keyframesStart + 1);
  const marqueeKeyframes = keyframesStart >= 0
    ? styles.slice(keyframesStart, nextKeyframesStart >= 0 ? nextKeyframesStart : undefined)
    : "";

  assert.notEqual(keyframesStart, -1, "expected title marquee keyframes to exist");
  assert.match(marqueeKeyframes, /0%\s*\{\s*transform:\s*translateX\(0\);/);
  assert.match(
    marqueeKeyframes,
    /100%\s*\{\s*transform:\s*translateX\(calc\(-1 \* var\(--title-marquee-distance\)\)\);/
  );
  assert.doesNotMatch(marqueeKeyframes, /10%|90%/);
});

test("unchanged overlay state does not reschedule the title marquee", () => {
  const appPath = path.resolve("public/app.js");
  const source = fs.readFileSync(appPath, "utf8");
  const { context, getRequestAnimationFrameCalls } = createOverlayTestContext();

  vm.createContext(context);
  vm.runInContext(source, context, {
    filename: appPath
  });

  const title = context.document.getElementById("current-title");
  const titleText = context.document.getElementById("current-title-text");
  title.clientWidth = 140;
  title.offsetWidth = 140;
  titleText.scrollWidth = 320;
  titleText.offsetWidth = 320;

  context.__state = {
    currentTrack: {
      id: "yt-repeat",
      provider: "youtube",
      title: "A repeating long title",
      url: "https://www.youtube.com/watch?v=repeat123",
      origin: "playlist"
    },
    queue: []
  };

  vm.runInContext("updateState(__state);", context);
  assert.equal(getRequestAnimationFrameCalls(), 1);

  vm.runInContext("updateState(__state);", context);
  assert.equal(getRequestAnimationFrameCalls(), 1);
});

test("finished soundcloud playback preserves the handoff path for the next youtube track", () => {
  const appPath = path.resolve("public/app.js");
  const source = fs.readFileSync(appPath, "utf8");
  const { context, locationReplaceCalls, sessionStorageData } = createOverlayTestContext();

  vm.createContext(context);
  vm.runInContext(source, context, {
    filename: appPath
  });

  context.__state = {
    currentTrack: null,
    queue: []
  };
  context.__nextTrack = {
    id: "yt-next",
    provider: "youtube",
    title: "Next YouTube Track",
    url: "https://www.youtube.com/watch?v=abc123",
    origin: "playlist"
  };

  vm.runInContext(
    'activeTrack = { id: "sc-finished", provider: "soundcloud" }; currentTrackId = "sc-finished";',
    context
  );
  vm.runInContext("updateState(__state);", context);
  vm.runInContext("loadTrack(__nextTrack);", context);

  assert.equal(locationReplaceCalls.length, 1);
  assert.equal(sessionStorageData.get("soundcloud-to-youtube-reload-track"), "yt-next");
  assert.match(locationReplaceCalls[0], /handoffReload=/);
});

test("overlay queue treats track titles and requesters as text", () => {
  const appPath = path.resolve("public/app.js");
  const source = fs.readFileSync(appPath, "utf8");
  const { context } = createOverlayTestContext();

  vm.createContext(context);
  vm.runInContext(source, context, {
    filename: appPath
  });

  context.__state = {
    currentTrack: {
      id: "yt-safe",
      provider: "youtube",
      title: "Current track",
      url: "https://www.youtube.com/watch?v=safe123",
      origin: "playlist"
    },
    queue: [
      {
        id: "queued-malicious",
        provider: "youtube",
        title: '<img src=x onerror="window.__xssTitle=1">',
        url: "https://www.youtube.com/watch?v=queued123",
        origin: "queue",
        requestedBy: {
          username: "viewer",
          displayName: '<svg onload="window.__xssRequester=1">'
        }
      }
    ]
  };

  vm.runInContext("updateState(__state);", context);

  const queueList = context.document.getElementById("queue-list");
  assert.equal(queueList.children.length, 1);
  assert.equal(queueList.children[0].innerHTML, "");
  assert.equal(queueList.children[0].children.length, 2);
  assert.equal(queueList.children[0].children[0].textContent, '<img src=x onerror="window.__xssTitle=1">');
  assert.equal(queueList.children[0].children[1].textContent, '<svg onload="window.__xssRequester=1">');
  assert.equal(context.window.__xssTitle, undefined);
  assert.equal(context.window.__xssRequester, undefined);
});

test("embedded player volume messages update both providers", () => {
  const appPath = path.resolve("public/app.js");
  const source = fs.readFileSync(appPath, "utf8");
  const { context, dispatchWindowEvent } = createOverlayTestContext();

  vm.createContext(context);
  vm.runInContext(source, context, {
    filename: appPath
  });

  vm.runInContext(`
    globalThis.__youtubeVolumeCalls = [];
    globalThis.__youtubeMuted = false;
    globalThis.__soundCloudVolumeCalls = [];
    youtubePlayer = {
      setVolume(value) { globalThis.__youtubeVolumeCalls.push(value); },
      mute() { globalThis.__youtubeMuted = true; },
      unMute() { globalThis.__youtubeMuted = false; }
    };
    soundCloudWidget = {
      setVolume(value) { globalThis.__soundCloudVolumeCalls.push(value); }
    };
  `, context);

  dispatchWindowEvent("message", {
    origin: "http://localhost:3000",
    data: {
      type: "gui-player:set-volume",
      volume: 35
    }
  });

  assert.deepEqual(Array.from(context.__youtubeVolumeCalls), [35]);
  assert.deepEqual(Array.from(context.__soundCloudVolumeCalls), [35]);
  assert.equal(context.__youtubeMuted, false);

  dispatchWindowEvent("message", {
    origin: "http://localhost:3000",
    data: {
      type: "gui-player:set-volume",
      volume: 0
    }
  });

  assert.deepEqual(Array.from(context.__youtubeVolumeCalls), [35, 0]);
  assert.deepEqual(Array.from(context.__soundCloudVolumeCalls), [35, 0]);
  assert.equal(context.__youtubeMuted, true);
});
