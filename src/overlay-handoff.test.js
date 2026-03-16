import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

function createClassList() {
  return {
    add() {
    },
    remove() {
    }
  };
}

function createElement(id = "") {
  return {
    id,
    className: "",
    classList: createClassList(),
    style: {
      display: "",
      width: "",
      setProperty() {
      },
      removeProperty() {
      }
    },
    textContent: "",
    innerHTML: "",
    offsetWidth: 0,
    clientWidth: 0,
    scrollWidth: 0,
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
      callback();
      return nextTimerId++;
    },
    cancelAnimationFrame() {
    },
    setTimeout() {
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
    sessionStorageData
  };
}

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
