import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("only the external AutoDJ controller boundary remains in runtime surfaces", () => {
  const server = read("src/app-server.ts");
  const player = read("src/player-controller.ts");
  const browserPlayer = read("client/app.ts");
  const dashboard = read("client/dashboard.ts");

  assert.doesNotMatch(server, /\/api\/local-music|\/autodj-overlay|AutoDjServiceCoordinator|LocalMusic|NativeAutoDj/);
  assert.doesNotMatch(player, /autoDjRequestQueue|localAssetId|provider === ["']local|player:autodj/);
  assert.doesNotMatch(browserPlayer, /player:autodj|AutoDjMixer|native-autodj|provider === ["']local/);
  assert.doesNotMatch(dashboard, /local-music-autodj|transition-lab|autodj-mix-style|autodj-audio-backend/);

  assert.match(server, /\/api\/autodj-service\/status/);
  assert.match(server, /\/api\/autodj-service\/activation/);
  assert.match(server, /\/api\/autodj-service\/mix-next/);
  assert.match(server, /\/autodj-output/);
  assert.match(dashboard, /Standalone service/);
});

test("removed AutoDJ engine implementation and packaging resources are absent", () => {
  const forbiddenPaths = [
    "analyzer",
    "native",
    "client/autodj-mixer.ts",
    "client/autodj-overlay.ts",
    "client/transition-lab.ts",
    "public/autodj-overlay.html",
    "public/native-autodj-audio-worklet.js",
    "scripts/build-native-autodj-audio.ts",
    "src/local-music-library.ts",
    "src/autodj-transition-planner.ts",
    "src/native-autodj-audio-runtime.ts",
    "src/traktor-library.ts"
  ];
  for (const relativePath of forbiddenPaths) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, `${relativePath} must not ship`);
  }

  const packageJson = read("package.json");
  assert.doesNotMatch(packageJson, /extraResources|build:native-autodj|test:native-autodj|prototype:traktor/);
});

test("generated runtime contains no embedded AutoDJ engine bundle", () => {
  const forbiddenName = /(?:autodj-(?:mixer|overlay|transition)|native-autodj|transition-lab|local-music)/i;
  for (const directory of ["build", "public"]) {
    if (!fs.existsSync(path.join(root, directory))) continue;
    const pending = [path.join(root, directory)];
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolutePath = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(absolutePath);
        else assert.doesNotMatch(path.relative(root, absolutePath), forbiddenName);
      }
    }
  }
});
