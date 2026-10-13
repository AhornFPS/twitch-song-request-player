import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const zeroOid = /^0+$/;
const credentialFields = [
  "twitchOauthToken", "twitchRefreshToken", "twitchClientSecret", "youtubeApiKey",
  "obsWebSocketPassword", "autoDjServiceToken", "TWITCH_OAUTH_TOKEN",
  "TWITCH_REFRESH_TOKEN", "TWITCH_CLIENT_SECRET", "YOUTUBE_API_KEY",
  "OBS_WEBSOCKET_PASSWORD", "AUTODJ_SERVICE_TOKEN"
].join("|");

function git(args, cwd, input) {
  // Never surface Git's captured content or command errors: they may contain secrets.
  try {
    return execFileSync("git", args, {
      cwd, input, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024
    });
  } catch {
    throw new Error("Secret scan could not read Git data; refusing to continue.");
  }
}

export function isPrivateRuntimePath(file) {
  const name = path.posix.basename(file.replaceAll("\\", "/"));
  return (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) ||
    /^(?:settings|queue-state|request-log|playlist-health)(?:[._-].*)?\.json(?:[._-].*)?$/i.test(name);
}

export function scanContent(file, contents) {
  const findings = [];
  if (isPrivateRuntimePath(file)) {
    findings.push({ file, line: 1, rule: "private runtime file" });
  }
  // Decode both common text encodings; binary files are still checked for embedded keys.
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  const texts = [bytes.toString("utf8"), bytes.toString("utf16le")];
  const rules = [
    ["Google API key", /AIza[0-9A-Za-z_-]{35}/g],
    ["GitHub token", /(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g],
    ["AWS access key", /(?:AKIA|ASIA)[A-Z0-9]{16}/g],
    ["private key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
    ["Twitch OAuth token", /oauth:[a-z0-9]{20,}/gi],
    ["credential literal", new RegExp(
      `\\b(?:${credentialFields})\\b["']?\\s*[:=]\\s*(["'])([A-Za-z0-9_.:/+-]{24,})\\1`, "g"
    )],
    ["credential literal", new RegExp(
      `^[ \\t]*(?:${credentialFields})[ \\t]*=[ \\t]*([A-Za-z0-9_.:/+-]{24,})(?:[ \\t]+#[^\\r\\n]*)?[ \\t]*\\r?$`, "gm"
    )]
  ];
  for (const text of texts) {
    for (const [rule, pattern] of rules) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        // Only explicit, recognizable examples are allowed. Token-shaped keys above
        // are always blocked, including ones used in test files.
        if (rule === "Twitch OAuth token" && /^oauth:x+$/i.test(match[0])) continue;
        if (rule === "credential literal" && /^(?:your_|test[-_]|fake[-_]|fixture[-_]|dummy[-_]|mock[-_]|example[-_]|sample[-_]|x+$|oauth:x+$)/i.test(match.at(-1))) continue;
        findings.push({ file, line: text.slice(0, match.index).split("\n").length, rule });
      }
    }
  }
  return findings.filter((finding, index, all) =>
    all.findIndex((other) => JSON.stringify(other) === JSON.stringify(finding)) === index);
}

function readBlobs(entries, cwd) {
  if (entries.length === 0) return [];
  const batch = git(["cat-file", "--batch"], cwd, entries.map((entry) => entry.oid).join("\n") + "\n");
  let offset = 0;
  const findings = [];
  for (const entry of entries) {
    const end = batch.indexOf(10, offset);
    const header = batch.subarray(offset, end).toString("ascii");
    const match = header.match(/^[a-f0-9]+ blob (\d+)$/);
    if (end < 0 || !match) throw new Error("Secret scan received invalid Git data; refusing to continue.");
    const size = Number(match[1]);
    offset = end + 1;
    const contents = batch.subarray(offset, offset + size);
    if (contents.length !== size) throw new Error("Secret scan received incomplete Git data.");
    findings.push(...scanContent(entry.file, contents));
    offset += size + 1;
  }
  return findings;
}

export function scanIndex(cwd) {
  const rows = git(["ls-files", "--stage", "-z"], cwd).toString("utf8").split("\0").filter(Boolean);
  const entries = rows.map((row) => {
    const match = row.match(/^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/);
    if (!match || match[3] !== "0" || match[1] === "160000") {
      throw new Error("Secret scan cannot verify an unmerged index or submodule.");
    }
    return { oid: match[2], file: match[4] };
  });
  return readBlobs(entries, cwd);
}

export function scanCommit(commit, cwd) {
  const rows = git(["ls-tree", "-r", "-z", commit], cwd).toString("utf8").split("\0").filter(Boolean);
  const entries = rows.map((row) => {
    const match = row.match(/^\d+ blob ([a-f0-9]+)\t([\s\S]+)$/);
    if (!match) throw new Error("Secret scan cannot verify a submodule.");
    return { oid: match[1], file: match[2] };
  });
  return readBlobs(entries, cwd).map((finding) => ({ ...finding, commit: commit.slice(0, 12) }));
}

export function scanWorkingTree(cwd) {
  const files = git(["ls-files", "-z"], cwd).toString("utf8").split("\0").filter(Boolean);
  return files.flatMap((file) => {
    const filePath = path.join(cwd, file);
    if (!fs.existsSync(filePath)) return [];
    return scanContent(file, fs.readFileSync(filePath));
  });
}

export function scanPackage(cwd) {
  const files = [];
  function walk(relative) {
    const absolute = path.join(cwd, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("Secret scan cannot verify a package symlink.");
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute)) walk(path.join(relative, name));
    } else files.push(relative);
  }
  for (const relative of ["build", "public", "playlist.csv", "package.json"]) walk(relative);
  return files.flatMap((file) => scanContent(file, fs.readFileSync(path.join(cwd, file))));
}

function revisions(args, cwd) {
  return git(["rev-list", ...args, "--"], cwd).toString("ascii").trim().split("\n").filter(Boolean);
}

export function scanPush(input, cwd) {
  const commits = new Set();
  for (const row of input.trim().split(/\r?\n/).filter(Boolean)) {
    const fields = row.split(/\s+/);
    if (fields.length !== 4 || !/^[a-f0-9]+$/.test(fields[1]) || !/^[a-f0-9]+$/.test(fields[3])) {
      throw new Error("Secret scan could not parse the push refs.");
    }
    const [, localOid, , remoteOid] = fields;
    if (zeroOid.test(localOid)) continue; // Deleting a ref introduces no data.
    const introduced = zeroOid.test(remoteOid)
      ? revisions([localOid, "--not", "--remotes"], cwd)
      : revisions([`${remoteOid}..${localOid}`], cwd);
    for (const commit of [localOid, ...introduced]) commits.add(commit);
  }
  return [...commits].flatMap((commit) => scanCommit(commit, cwd));
}

export function formatFindings(findings) {
  // Never include matched text, line contents, tokens, or raw subprocess errors.
  return findings.map(({ file, line, rule, commit }) =>
    `${JSON.stringify(file)}:${line}: ${rule}${commit ? ` (commit ${commit})` : ""}`).join("\n");
}

function main(args, cwd) {
  let findings;
  if (args.length === 0) findings = scanWorkingTree(cwd);
  else if (args.length === 1 && args[0] === "--staged") findings = scanIndex(cwd);
  else if (args.length === 1 && args[0] === "--package") findings = scanPackage(cwd);
  else if (args.length === 1 && args[0] === "--pre-push") findings = scanPush(fs.readFileSync(0, "utf8"), cwd);
  else if (args.length === 1 && args[0] === "--ci") {
    const head = process.env.SECRET_SCAN_HEAD || "HEAD";
    let base = process.env.SECRET_SCAN_BASE;
    if (!base || zeroOid.test(base)) {
      const defaultRef = `refs/remotes/origin/${process.env.SECRET_SCAN_DEFAULT_BRANCH || "main"}`;
      base = git(["merge-base", head, defaultRef], cwd).toString("ascii").trim();
    }
    findings = [...new Set([head, ...revisions([`${base}..${head}`], cwd)])]
      .flatMap((commit) => scanCommit(commit, cwd));
  } else throw new Error("Usage: node scripts/check-secrets.mjs [--staged|--pre-push|--package|--ci]");
  if (findings.length) {
    console.error(`Secret scan blocked ${findings.length} finding(s):\n${formatFindings(findings)}`);
    console.error("Keep credentials and runtime backups local. Rotate any credential already published.");
    process.exitCode = 1;
  } else console.log("Secret scan passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2), process.cwd());
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Secret scan failed.");
    process.exitCode = 1;
  }
}
