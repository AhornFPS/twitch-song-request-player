import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildReleaseNotes, bumpVersion, rollChangelogRelease } from "./release-lib.js";

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
