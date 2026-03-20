import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveAppRootFromModuleDir } from "./runtime-paths.js";

test("resolveAppRootFromModuleDir keeps source directories rooted at the project", () => {
  const projectRoot = path.join("D:", "repo");

  assert.equal(
    resolveAppRootFromModuleDir(path.join(projectRoot, "src")),
    projectRoot
  );

  assert.equal(
    resolveAppRootFromModuleDir(path.join(projectRoot, "electron")),
    projectRoot
  );

  assert.equal(
    resolveAppRootFromModuleDir(path.join(projectRoot, "build")),
    projectRoot
  );
});

test("resolveAppRootFromModuleDir maps built runtime directories back to the app root", () => {
  const projectRoot = path.join("D:", "repo");

  assert.equal(
    resolveAppRootFromModuleDir(path.join(projectRoot, "build", "src")),
    projectRoot
  );

  assert.equal(
    resolveAppRootFromModuleDir(path.join(projectRoot, "build", "electron")),
    projectRoot
  );
});

test("resolveAppRootFromModuleDir maps packaged build directories back to app.asar", () => {
  const appRoot = path.join("C:", "Program Files", "App", "resources", "app.asar");

  assert.equal(
    resolveAppRootFromModuleDir(path.join(appRoot, "build", "src")),
    appRoot
  );

  assert.equal(
    resolveAppRootFromModuleDir(path.join(appRoot, "build", "electron")),
    appRoot
  );
});
