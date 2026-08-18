import assert from "node:assert/strict";
import test from "node:test";
import { shouldEnableDesktopUpdates } from "./electron-update-runtime.js";

test("installed packaged builds enable desktop updates", () => {
  assert.equal(shouldEnableDesktopUpdates({
    isPackaged: true,
    portableExecutableDir: ""
  }), true);
});

test("portable packaged builds do not initialize electron-updater", () => {
  assert.equal(shouldEnableDesktopUpdates({
    isPackaged: true,
    portableExecutableDir: "C:\\Portable\\Song Request Player"
  }), false);
});

test("development builds do not initialize electron-updater", () => {
  assert.equal(shouldEnableDesktopUpdates({
    isPackaged: false,
    portableExecutableDir: ""
  }), false);
});
