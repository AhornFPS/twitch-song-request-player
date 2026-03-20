// @ts-nocheck
import fs from "node:fs/promises";
import path from "node:path";

function normalizeVersion(version) {
  const value = String(version ?? "").trim();
  return value.toLowerCase().startsWith("v") ? value.slice(1) : value;
}

function assertValidSemver(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
}

function versionTitleMatches(title, version) {
  const normalizedTitle = normalizeVersion(title).trim();
  const normalizedVersion = normalizeVersion(version);

  return (
    normalizedTitle === normalizedVersion ||
    normalizedTitle.startsWith(`${normalizedVersion} `)
  );
}

function trimOuterBlankLines(text) {
  const lines = text.split(/\r?\n/);

  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }

  while (lines.length > 0 && !lines.at(-1)?.trim()) {
    lines.pop();
  }

  return lines.join("\n");
}

function parseSections(text) {
  const matches = [...text.matchAll(/^##\s+(.+?)\s*$/gm)];
  if (matches.length === 0) {
    return {
      preamble: text,
      sections: []
    };
  }

  const preamble = text.slice(0, matches[0].index);
  const sections = matches.map((match, index) => {
    const bodyStart = match.index + match[0].length;
    const nextMatch = matches[index + 1];
    const bodyEnd = nextMatch ? nextMatch.index : text.length;

    return {
      title: match[1].trim(),
      body: text.slice(bodyStart, bodyEnd)
    };
  });

  return { preamble, sections };
}

function rebuildChangelog(preamble, sections) {
  const parts = [];

  if (preamble.trim()) {
    parts.push(`${preamble.trimEnd()}\n\n`);
  }

  for (const section of sections) {
    parts.push(`## ${section.title}\n\n`);

    const body = trimOuterBlankLines(section.body ?? "");
    if (body) {
      parts.push(`${body}\n\n`);
    }
  }

  return `${parts.join("").trimEnd()}\n`;
}

function getSectionByTitle(sections, title) {
  return sections.find((section) => section.title.toLowerCase() === title.toLowerCase()) ?? null;
}

export function bumpVersion(currentVersion, releaseType) {
  const normalizedCurrent = normalizeVersion(currentVersion);
  assertValidSemver(normalizedCurrent);

  if (["patch", "minor", "major"].includes(releaseType)) {
    const [major, minor, patch] = normalizedCurrent.split(".").map(Number);

    if (releaseType === "patch") {
      return `${major}.${minor}.${patch + 1}`;
    }

    if (releaseType === "minor") {
      return `${major}.${minor + 1}.0`;
    }

    return `${major + 1}.0.0`;
  }

  const explicitVersion = normalizeVersion(releaseType);
  assertValidSemver(explicitVersion);

  if (explicitVersion === normalizedCurrent) {
    throw new Error(`Release version ${explicitVersion} matches the current version.`);
  }

  return explicitVersion;
}

export async function readPackageVersion(packageJsonPath) {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const version = normalizeVersion(packageJson.version);
  assertValidSemver(version);
  return version;
}

export async function readUnreleasedNotes(changelogPath) {
  const text = await fs.readFile(changelogPath, "utf8");
  const { sections } = parseSections(text);
  const unreleased = getSectionByTitle(sections, "Unreleased");

  if (!unreleased) {
    throw new Error("CHANGELOG.md does not contain a '## Unreleased' section.");
  }

  const body = trimOuterBlankLines(unreleased.body);
  if (!body) {
    throw new Error("CHANGELOG.md has no unreleased notes to publish.");
  }

  return body;
}

export async function rollChangelogRelease(changelogPath, version, releaseDate) {
  const normalizedVersion = normalizeVersion(version);
  assertValidSemver(normalizedVersion);

  const text = await fs.readFile(changelogPath, "utf8");
  const { preamble, sections } = parseSections(text);

  if (sections.length === 0) {
    throw new Error("CHANGELOG.md has no level-2 sections.");
  }

  const unreleasedIndex = sections.findIndex((section) => section.title.toLowerCase() === "unreleased");
  if (unreleasedIndex === -1) {
    throw new Error("CHANGELOG.md does not contain a '## Unreleased' section.");
  }

  const unreleasedBody = trimOuterBlankLines(sections[unreleasedIndex].body);
  if (!unreleasedBody) {
    throw new Error("CHANGELOG.md has no unreleased notes to publish.");
  }

  const versionIndex = sections.findIndex((section) => versionTitleMatches(section.title, normalizedVersion));
  if (versionIndex === -1) {
    sections.splice(unreleasedIndex + 1, 0, {
      title: `${normalizedVersion} - ${releaseDate}`,
      body: `\n${unreleasedBody}\n`
    });
  } else {
    const existingBody = trimOuterBlankLines(sections[versionIndex].body);
    const mergedBody = existingBody ? `${unreleasedBody}\n\n${existingBody}` : unreleasedBody;
    sections[versionIndex].body = `\n${mergedBody}\n`;
  }

  sections[unreleasedIndex].body = "\n";

  const updatedText = rebuildChangelog(preamble, sections);
  await fs.writeFile(changelogPath, updatedText, "utf8");
}

export async function buildReleaseNotes(changelogPath, version, { fallbackToUnreleased = false } = {}) {
  const normalizedVersion = normalizeVersion(version);
  assertValidSemver(normalizedVersion);

  const text = await fs.readFile(changelogPath, "utf8");
  const { sections } = parseSections(text);

  let selected = sections.find((section) => versionTitleMatches(section.title, normalizedVersion)) ?? null;
  if (!selected && fallbackToUnreleased) {
    selected = getSectionByTitle(sections, "Unreleased");
  }

  if (!selected) {
    throw new Error(`Could not find release notes for version ${normalizedVersion}.`);
  }

  const body = trimOuterBlankLines(selected.body);
  const sectionBody = body || "- No changelog entries were found for this release.";
  return `## ${selected.title}\n\n${sectionBody}\n`;
}

function stripWrappedValue(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  const quote = normalized[0];
  if ((quote === "'" || quote === "\"") && normalized.at(-1) === quote) {
    return normalized.slice(1, -1);
  }

  return normalized;
}

export function parsePrimaryReleaseArtifactName(latestYamlText) {
  const match = String(latestYamlText ?? "").match(/^\s*path:\s*(.+)\s*$/m);

  if (!match) {
    throw new Error("latest.yml does not contain a primary artifact path.");
  }

  const artifactName = stripWrappedValue(match[1]);
  if (!artifactName) {
    throw new Error("latest.yml contains an empty primary artifact path.");
  }

  return artifactName;
}

export async function readReleaseArtifacts(distDir, portableArtifactName) {
  const latestYamlPath = path.join(distDir, "latest.yml");
  const latestYamlText = await fs.readFile(latestYamlPath, "utf8");
  const setupArtifactName = parsePrimaryReleaseArtifactName(latestYamlText);

  return [
    path.join(distDir, setupArtifactName),
    path.join(distDir, `${setupArtifactName}.blockmap`),
    latestYamlPath,
    path.join(distDir, portableArtifactName)
  ];
}
