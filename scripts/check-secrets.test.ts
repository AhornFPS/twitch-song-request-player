// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  formatFindings, isPrivateRuntimePath, scanCommit, scanContent, scanIndex,
  scanPackage, scanPush, scanWorkingTree
} from "./check-secrets.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scannerPath = path.join(rootDir, "scripts", "check-secrets.mjs");
// Assemble synthetic keys so the tests themselves contain no token-shaped literal.
const googleKey = "AIza" + "B".repeat(35);
const oauthToken = "oauth:" + "a".repeat(30);

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function repository(t) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "music-secret-check-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "Secret check fixture");
  git(cwd, "config", "user.email", "fixture@example.invalid");
  git(cwd, "config", "core.hooksPath", path.join(cwd, "no-hooks"));
  await fs.writeFile(path.join(cwd, "source.txt"), "clean\n");
  git(cwd, "add", "source.txt");
  git(cwd, "commit", "-m", "clean baseline");
  return cwd;
}

test("runtime credentials and snapshot variants are rejected at every depth", () => {
  for (const file of ["settings.json", "settings.backup.json", "nested/settings.json.123.tmp", ".env", ".env.production", "nested/.env.local", "request-log.json.backup", "queue-state.json", "playlist-health.json"]) {
    assert.equal(isPrivateRuntimePath(file), true, file);
    assert.equal(scanContent(file, "{}")[0].rule, "private runtime file");
  }
  for (const file of [".env.example", "src/config.ts", "src/dashboard-settings.test.ts", "playlist.csv"]) {
    assert.equal(isPrivateRuntimePath(file), false, file);
  }
});

test("keys in source, documentation, binaries and UTF-16 are rejected without logging values", () => {
  for (const contents of [googleKey, Buffer.from(googleKey, "utf16le"), Buffer.concat([Buffer.from([0, 1]), Buffer.from(googleKey)])]) {
    const findings = scanContent("fixture.txt", contents);
    assert.ok(findings.some((finding) => finding.rule === "Google API key"));
    assert.ok(!formatFindings(findings).includes(googleKey));
  }
  for (const [rule, contents] of [
    ["GitHub token", "ghp_" + "a".repeat(36)],
    ["AWS access key", "AKIA" + "A".repeat(16)],
    ["private key", "-----BEGIN " + "PRIVATE KEY-----"],
    ["Twitch OAuth token", oauthToken],
    ["credential literal", JSON.stringify({ twitchRefreshToken: "b".repeat(30) })],
    ["credential literal", "TWITCH_CLIENT_SECRET=" + "c".repeat(30)],
    ["credential literal", "TWITCH_CLIENT_SECRET=" + "c".repeat(30) + " # local override\r\n"]
  ]) {
    assert.ok(scanContent("fixture.txt", contents).some((finding) => finding.rule === rule));
  }
  assert.deepEqual(scanContent(".env.example", "TWITCH_OAUTH_TOKEN=oauth:" + "x".repeat(22) + "\nYOUTUBE_API_KEY=your_youtube_data_api_key"), []);
  assert.deepEqual(scanContent("fixture.ts", 'twitchRefreshToken: "test-refresh-token-placeholder"'), []);
  assert.deepEqual(scanContent("fixture.ts", "twitchRefreshToken: settings.twitchRefreshToken"), []);
  assert.equal(scanContent("fixture.txt", "first\n" + googleKey)[0].line, 2);
});

test("staged bytes are checked even when the working copy has been cleaned", async (t) => {
  const cwd = await repository(t);
  await fs.writeFile(path.join(cwd, "source.txt"), googleKey);
  git(cwd, "add", "source.txt");
  await fs.writeFile(path.join(cwd, "source.txt"), "clean again\n");
  assert.deepEqual(scanWorkingTree(cwd), []);
  assert.equal(scanIndex(cwd)[0].rule, "Google API key");
  const check = spawnSync(process.execPath, [scannerPath, "--staged"], { cwd, encoding: "utf8" });
  assert.equal(check.status, 1);
  assert.ok(check.stderr.includes("Google API key"));
  assert.ok(!check.stderr.includes(googleKey));
});

test("ignored settings backups stay on disk but force-adding them is blocked", async (t) => {
  const cwd = await repository(t);
  await fs.copyFile(path.join(rootDir, ".gitignore"), path.join(cwd, ".gitignore"));
  await fs.writeFile(path.join(cwd, "settings.backup.json"), JSON.stringify({ youtubeApiKey: googleKey }));
  git(cwd, "add", ".gitignore");
  assert.equal(git(cwd, "check-ignore", "settings.backup.json"), "settings.backup.json");
  assert.deepEqual(scanWorkingTree(cwd), []);
  git(cwd, "add", "--force", "settings.backup.json");
  assert.ok(scanIndex(cwd).some((finding) => finding.rule === "private runtime file"));
  assert.ok((await fs.readFile(path.join(cwd, "settings.backup.json"), "utf8")).includes(googleKey));
});

test("push checks catch a credential introduced and removed in intermediate commits", async (t) => {
  const cwd = await repository(t);
  const base = git(cwd, "rev-parse", "HEAD");
  git(cwd, "update-ref", "refs/remotes/origin/main", base);
  await fs.writeFile(path.join(cwd, "source.txt"), googleKey);
  git(cwd, "add", "source.txt");
  git(cwd, "commit", "-m", "accidental secret");
  const leaked = git(cwd, "rev-parse", "HEAD");
  await fs.writeFile(path.join(cwd, "source.txt"), "clean again\n");
  git(cwd, "add", "source.txt");
  git(cwd, "commit", "-m", "remove secret");
  const head = git(cwd, "rev-parse", "HEAD");
  assert.deepEqual(scanCommit(head, cwd), []);
  const existing = scanPush(`refs/heads/main ${head} refs/heads/main ${base}\n`, cwd);
  const newBranch = scanPush(`refs/heads/new ${head} refs/heads/new ${"0".repeat(40)}\n`, cwd);
  for (const findings of [existing, newBranch]) {
    assert.ok(findings.some((finding) => finding.commit === leaked.slice(0, 12)));
    assert.ok(!formatFindings(findings).includes(googleKey));
  }
  assert.deepEqual(scanPush(`(delete) ${"0".repeat(40)} refs/heads/main ${base}\n`, cwd), []);
  assert.throws(() => scanPush("malformed push", cwd));
  const ci = spawnSync(process.execPath, [scannerPath, "--ci"], {
    cwd, encoding: "utf8", env: { ...process.env, SECRET_SCAN_BASE: base, SECRET_SCAN_HEAD: head }
  });
  assert.equal(ci.status, 1);
  assert.ok(!ci.stderr.includes(googleKey));
});

test("push checks allow a clean fix above already-published contaminated history", async (t) => {
  const cwd = await repository(t);
  await fs.writeFile(path.join(cwd, "source.txt"), googleKey);
  git(cwd, "add", "source.txt");
  git(cwd, "commit", "-m", "already published secret");
  const remote = git(cwd, "rev-parse", "HEAD");
  git(cwd, "update-ref", "refs/remotes/origin/main", remote);
  await fs.writeFile(path.join(cwd, "source.txt"), "clean\n");
  git(cwd, "add", "source.txt");
  git(cwd, "commit", "-m", "clean fix");
  const head = git(cwd, "rev-parse", "HEAD");
  assert.deepEqual(scanPush(`refs/heads/main ${head} refs/heads/main ${remote}\n`, cwd), []);
});

test("packaged files are checked independently of Git tracking", async (t) => {
  const cwd = await repository(t);
  await fs.mkdir(path.join(cwd, "build"));
  await fs.mkdir(path.join(cwd, "public"));
  await fs.writeFile(path.join(cwd, "playlist.csv"), "id,title\n");
  await fs.writeFile(path.join(cwd, "package.json"), "{}");
  await fs.writeFile(path.join(cwd, "build", "bundled-config.json"), JSON.stringify({ twitchClientId: "public-client-id" }));
  assert.deepEqual(scanPackage(cwd), []);
  await fs.writeFile(path.join(cwd, "build", "leftover.txt"), googleKey);
  assert.equal(scanPackage(cwd)[0].rule, "Google API key");
  await fs.writeFile(path.join(cwd, "build", "settings.backup.json"), "{}");
  assert.ok(scanPackage(cwd).some((finding) => finding.rule === "private runtime file"));
});

test("actual Git hooks reject commits and pushes with secrets", async (t) => {
  const cwd = await repository(t);
  await fs.mkdir(path.join(cwd, "scripts"));
  await fs.copyFile(scannerPath, path.join(cwd, "scripts", "check-secrets.mjs"));
  await fs.cp(path.join(rootDir, ".githooks"), path.join(cwd, ".githooks"), { recursive: true });
  for (const name of ["pre-commit", "pre-push"]) await fs.chmod(path.join(cwd, ".githooks", name), 0o755);
  git(cwd, "config", "core.hooksPath", ".githooks");
  await fs.writeFile(path.join(cwd, "source.txt"), googleKey);
  git(cwd, "add", "source.txt");
  const commit = spawnSync("git", ["commit", "-m", "should be rejected"], { cwd, encoding: "utf8" });
  assert.notEqual(commit.status, 0);
  assert.ok(commit.stderr.includes("Google API key"));
  assert.ok(!commit.stderr.includes(googleKey));
  // Intentionally bypass the first guard to prove the push guard separately.
  git(cwd, "-c", "core.hooksPath=no-hooks", "commit", "-m", "bypassed commit fixture");
  const remote = path.join(cwd, "remote.git");
  git(cwd, "init", "--bare", remote);
  const push = spawnSync("git", ["push", remote, "HEAD:main"], { cwd, encoding: "utf8" });
  assert.notEqual(push.status, 0);
  assert.ok(push.stderr.includes("Google API key"));
  assert.ok(!push.stderr.includes(googleKey));
});

test("release checks remain ahead of version changes and --skip-build publishing", async () => {
  const source = await fs.readFile(path.join(rootDir, "scripts", "release.ts"), "utf8");
  const firstMutation = source.indexOf('run(getNpmCommand(), ["version"');
  for (const check of ['["scripts/check-secrets.mjs"]', '["scripts/check-secrets.mjs", "--package"]']) {
    assert.ok(source.indexOf(check) > 0 && source.indexOf(check) < firstMutation);
  }
});

test("hook installation is repeatable and preserves custom hooks", async (t) => {
  const cwd = await repository(t);
  git(cwd, "config", "--unset", "core.hooksPath");
  await fs.mkdir(path.join(cwd, "scripts"));
  const installer = path.join(cwd, "scripts", "install-git-hooks.mjs");
  await fs.copyFile(path.join(rootDir, "scripts", "install-git-hooks.mjs"), installer);
  await fs.cp(path.join(rootDir, ".githooks"), path.join(cwd, ".githooks"), { recursive: true });
  const env = { ...process.env, CI: "" };
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = spawnSync(process.execPath, [installer], { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(cwd, "config", "--get", "core.hooksPath"), ".githooks");
  }
  git(cwd, "config", "core.hooksPath", "custom-hooks");
  assert.equal(spawnSync(process.execPath, [installer], { cwd, env }).status, 1);
  assert.equal(git(cwd, "config", "--get", "core.hooksPath"), "custom-hooks");
  git(cwd, "config", "--unset", "core.hooksPath");
  const customHook = path.join(cwd, ".git", "hooks", "pre-commit");
  await fs.writeFile(customHook, "custom hook contents\n");
  assert.equal(spawnSync(process.execPath, [installer], { cwd, env }).status, 1);
  assert.equal(await fs.readFile(customHook, "utf8"), "custom hook contents\n");
});
