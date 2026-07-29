import assert from "node:assert/strict";
import test from "node:test";
import { acquireSingleInstanceLock } from "./electron-single-instance.js";

function createAppHarness(lockAcquired: boolean) {
  let secondInstanceHandler: (() => void) | null = null;
  let quitCalls = 0;

  return {
    app: {
      on(event: "second-instance", listener: () => void) {
        assert.equal(event, "second-instance");
        secondInstanceHandler = listener;
      },
      quit() {
        quitCalls += 1;
      },
      requestSingleInstanceLock() {
        return lockAcquired;
      }
    },
    getQuitCalls() {
      return quitCalls;
    },
    triggerSecondInstance() {
      assert.ok(secondInstanceHandler);
      secondInstanceHandler();
    }
  };
}

test("a second app process quits when the single-instance lock is unavailable", () => {
  const harness = createAppHarness(false);

  const acquired = acquireSingleInstanceLock(harness.app, () => null);

  assert.equal(acquired, false);
  assert.equal(harness.getQuitCalls(), 1);
});

test("a second launch restores, shows, and focuses the existing app window", () => {
  const harness = createAppHarness(true);
  const calls: string[] = [];
  const mainWindow = {
    focus() {
      calls.push("focus");
    },
    isDestroyed() {
      return false;
    },
    isMinimized() {
      return true;
    },
    isVisible() {
      return false;
    },
    restore() {
      calls.push("restore");
    },
    show() {
      calls.push("show");
    }
  };

  const acquired = acquireSingleInstanceLock(harness.app, () => mainWindow);
  harness.triggerSecondInstance();

  assert.equal(acquired, true);
  assert.equal(harness.getQuitCalls(), 0);
  assert.deepEqual(calls, ["restore", "show", "focus"]);
});

test("a second launch does not interact with a destroyed app window", () => {
  const harness = createAppHarness(true);
  let focusCalls = 0;

  acquireSingleInstanceLock(harness.app, () => ({
    focus() {
      focusCalls += 1;
    },
    isDestroyed() {
      return true;
    },
    isMinimized() {
      return false;
    },
    isVisible() {
      return true;
    },
    restore() {},
    show() {}
  }));
  harness.triggerSecondInstance();

  assert.equal(focusCalls, 0);
});
