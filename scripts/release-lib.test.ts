// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildReleaseNotes, bumpVersion, parsePrimaryReleaseArtifactName, pruneOldSetupArtifacts, readReleaseArtifacts, rollChangelogRelease } from "./release-lib.js";

test("bumpVersion increments patch, minor, and major releases", () => {
  assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
  assert.equal(bumpVersion("1.2.3", "2.0.0"), "2.0.0");
});

test("rollChangelogRelease moves unreleased notes into a dated version section", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-sc-release-test-"));
  const changelogPath = path.join(tempDir, "CHANGELOG.md");

  await fs.writeFile(
    changelogPath,
    [
      "# Changelog",
      "",
      "## Unreleased",
      "",
      "- Added release automation.",
      "- Added versioned changelog notes.",
      "",
      "## 1.0.0 - 2026-03-15",
      "",
      "- Initial release.",
      ""
    ].join("\n"),
    "utf8"
  );

  await rollChangelogRelease(changelogPath, "1.0.1", "2026-03-16");
  const updated = await fs.readFile(changelogPath, "utf8");

  assert.match(updated, /## Unreleased\s*## 1\.0\.1 - 2026-03-16/s);
  assert.match(updated, /## 1\.0\.1 - 2026-03-16\s+- Added release automation\./s);
  assert.doesNotMatch(updated, /## Unreleased\s+- Added release automation\./s);
});

test("buildReleaseNotes returns the version section after changelog roll", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-sc-release-test-"));
  const changelogPath = path.join(tempDir, "CHANGELOG.md");

  await fs.writeFile(
    changelogPath,
    [
      "# Changelog",
      "",
      "## Unreleased",
      "",
      "## 1.0.1 - 2026-03-16",
      "",
      "- Added release automation.",
      ""
    ].join("\n"),
    "utf8"
  );

  const notes = await buildReleaseNotes(changelogPath, "1.0.1");
  assert.equal(notes, "## 1.0.1 - 2026-03-16\n\n- Added release automation.\n");
});

test("parsePrimaryReleaseArtifactName reads the setup filename from latest.yml", () => {
  const latestYaml = [
    "version: 1.4.5",
    "files:",
    "  - url: TwitchSongRequestPlayer-Setup-1.4.5.exe",
    "    sha512: abc123",
    "    size: 12345",
    "path: TwitchSongRequestPlayer-Setup-1.4.5.exe",
    "sha512: abc123"
  ].join("\n");

  assert.equal(
    parsePrimaryReleaseArtifactName(latestYaml),
    "TwitchSongRequestPlayer-Setup-1.4.5.exe"
  );
});

test("readReleaseArtifacts follows the filenames advertised in latest.yml", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-sc-release-artifacts-"));
  const distDir = path.join(tempDir, "dist");
  await fs.mkdir(distDir, { recursive: true });

  await fs.writeFile(
    path.join(distDir, "latest.yml"),
    [
      "version: 1.4.5",
      "path: TwitchSongRequestPlayer-Setup-1.4.5.exe",
      "sha512: abc123"
    ].join("\n"),
    "utf8"
  );

  const artifacts = await readReleaseArtifacts(distDir, "TwitchSongRequestPlayer-Portable.exe");

  assert.deepEqual(artifacts, [
    path.join(distDir, "TwitchSongRequestPlayer-Setup-1.4.5.exe"),
    path.join(distDir, "TwitchSongRequestPlayer-Setup-1.4.5.exe.blockmap"),
    path.join(distDir, "latest.yml"),
    path.join(distDir, "TwitchSongRequestPlayer-Portable.exe")
  ]);
});

test("pruneOldSetupArtifacts removes only older installers from the current artifact family", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-sc-release-prune-"));
  const distDir = path.join(tempDir, "dist");
  await fs.mkdir(path.join(distDir, "win-unpacked"), { recursive: true });

  const currentSetupName = "TwitchSongRequestPlayer-Setup-1.4.5.exe";
  const oldArtifactNames = [
    "TwitchSongRequestPlayer-Setup-1.4.3.exe",
    "TwitchSongRequestPlayer-Setup-1.4.3.exe.blockmap",
    "TwitchSongRequestPlayer-Setup-1.4.4.exe",
    "TwitchSongRequestPlayer-Setup-1.4.4.exe.blockmap"
  ];
  const keptFileNames = [
    currentSetupName,
    `${currentSetupName}.blockmap`,
    "TwitchSongRequestPlayer-Portable.exe",
    "latest.yml",
    "playlist.csv",
    "OtherPlayer-Setup-1.4.4.exe"
  ];

  for (const [index, fileName] of [...oldArtifactNames, ...keptFileNames].entries()) {
    await fs.writeFile(path.join(distDir, fileName), Buffer.alloc(index + 1));
  }

  const result = await pruneOldSetupArtifacts(distDir, path.join(distDir, currentSetupName));
  const remainingNames = (await fs.readdir(distDir)).sort();

  assert.deepEqual(
    result.removedPaths.map((artifactPath) => path.basename(artifactPath)).sort(),
    oldArtifactNames.sort()
  );
  assert.equal(result.reclaimedBytes, 1 + 2 + 3 + 4);
  assert.deepEqual(remainingNames, [...keptFileNames, "win-unpacked"].sort());
});

test("pruneOldSetupArtifacts skips pruning when the current artifact name is not versioned", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-sc-release-prune-"));
  const distDir = path.join(tempDir, "dist");
  await fs.mkdir(distDir, { recursive: true });
  await fs.writeFile(path.join(distDir, "custom-setup.exe"), "current");
  await fs.writeFile(path.join(distDir, "custom-setup-1.0.0.exe"), "old");

  const result = await pruneOldSetupArtifacts(
    distDir,
    path.join(distDir, "custom-setup.exe")
  );

  assert.deepEqual(result, { removedPaths: [], reclaimedBytes: 0 });
  assert.deepEqual((await fs.readdir(distDir)).sort(), [
    "custom-setup-1.0.0.exe",
    "custom-setup.exe"
  ]);
});

test("package.json pins the NSIS artifact name to the updater-compatible setup filename", async () => {
  const packageJsonPath = path.resolve(process.cwd(), "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));

  assert.equal(
    packageJson.build?.nsis?.artifactName,
    "TwitchSongRequestPlayer-Setup-${version}.${ext}"
  );
});
