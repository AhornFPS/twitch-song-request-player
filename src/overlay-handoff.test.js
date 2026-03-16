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
  return {
    id,
    className: "",
    classList: createClassList(),
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
    innerHTML: "",
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
    appendChild() {
    },
    removeAttribute() {
    }
  };
}

function createOverlayTestContext() {
  const elements = new Map();
  const sessionStorageData = new Map();
  const locationReplaceCalls = [];
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
    addEventListener() {
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
