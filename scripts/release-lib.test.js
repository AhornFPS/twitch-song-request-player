import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildReleaseNotes, bumpVersion, parsePrimaryReleaseArtifactName, readReleaseArtifacts, rollChangelogRelease } from "./release-lib.js";

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

test("package.json pins the NSIS artifact name to the updater-compatible setup filename", async () => {
  const packageJsonPath = path.resolve(process.cwd(), "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));

  assert.equal(
    packageJson.build?.nsis?.artifactName,
    "TwitchSongRequestPlayer-Setup-${version}.${ext}"
  );
});
