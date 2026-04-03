// @ts-nocheck

const TRACK_DESCRIPTOR_WORDS = new Set([
  "acoustic",
  "album",
  "alternate",
  "anniversary",
  "audio",
  "at",
  "bootleg",
  "clean",
  "clip",
  "cut",
  "demo",
  "deluxe",
  "dub",
  "edit",
  "extended",
  "explicit",
  "feat",
  "featuring",
  "full",
  "ft",
  "hd",
  "hq",
  "instrumental",
  "karaoke",
  "live",
  "lyric",
  "lyrics",
  "mix",
  "mono",
  "music",
  "my",
  "new",
  "newsong",
  "official",
  "on",
  "out",
  "performance",
  "premiere",
  "release",
  "remaster",
  "remastered",
  "remix",
  "reupload",
  "reverb",
  "recorded",
  "recording",
  "session",
  "short",
  "shorts",
  "single",
  "slowed",
  "song",
  "sped",
  "stereo",
  "stream",
  "streaming",
  "take",
  "teaser",
  "trailer",
  "uhd",
  "unplugged",
  "version",
  "video",
  "visualiser",
  "visualizer",
  "with"
]);

const TRACK_VARIANT_SIGNAL_WORDS = new Set([
  "acoustic",
  "alternate",
  "bootleg",
  "clean",
  "cut",
  "demo",
  "dub",
  "edit",
  "explicit",
  "feat",
  "featuring",
  "ft",
  "instrumental",
  "karaoke",
  "live",
  "lyric",
  "lyrics",
  "performance",
  "recorded",
  "recording",
  "remaster",
  "remastered",
  "remix",
  "reupload",
  "reverb",
  "session",
  "slowed",
  "sped",
  "take",
  "unplugged",
  "version",
  "video",
  "visualiser",
  "visualizer"
]);

function normalizeTrackText(value, fallback = "") {
  const normalizedValue = typeof value === "string"
    ? value.trim()
    : "";

  if (
    normalizedValue &&
    normalizedValue.toLowerCase() !== "undefined" &&
    normalizedValue.toLowerCase() !== "null"
  ) {
    return normalizedValue;
  }

  return fallback;
}

function splitArtistAndTitle(value) {
  const normalizedValue = normalizeTrackText(value, "");
  const match = normalizedValue.match(/^(.+?)\s(?:[-–—]|:|\|)\s(.+)$/);

  if (!match) {
    return null;
  }

  const artist = normalizeTrackText(match[1], "");
  const trackTitle = normalizeTrackText(match[2], "");

  if (!artist || !trackTitle) {
    return null;
  }

  return {
    artist,
    trackTitle
  };
}

function normalizeMatchText(value) {
  return normalizeTrackText(value, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”„‟]/g, "\"")
    .replace(/[‘’‚‛]/g, "'")
    .replaceAll("&", " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getIdentityTokens(value) {
  return normalizeMatchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function isDescriptorFragment(value) {
  const tokens = getIdentityTokens(value);

  if (tokens.length === 0) {
    return true;
  }

  let descriptorTokenCount = 0;
  let hasVariantSignal = false;
  let hasNumericHint = false;

  for (const token of tokens) {
    if (TRACK_DESCRIPTOR_WORDS.has(token) || /^\d+(?:k)?$/.test(token)) {
      descriptorTokenCount += 1;
    }

    if (TRACK_VARIANT_SIGNAL_WORDS.has(token)) {
      hasVariantSignal = true;
    }

    if (/^\d{4}$/.test(token)) {
      hasNumericHint = true;
    }
  }

  const descriptorRatio = descriptorTokenCount / tokens.length;

  return (
    descriptorTokenCount === tokens.length ||
    descriptorRatio >= 0.75 ||
    (
      hasVariantSignal &&
      descriptorRatio >= 0.5
    ) ||
    (
      hasVariantSignal &&
      hasNumericHint &&
      descriptorRatio >= 0.34
    )
  );
}

function extractQuotedTitle(value) {
  const normalizedValue = normalizeTrackText(value, "")
    .replace(/[“”„‟]/g, "\"")
    .replace(/[‘’‚‛]/g, "'");
  const quotedMatches = Array.from(
    normalizedValue.matchAll(/["']([^"']{2,120})["']/g),
    (match) => normalizeTrackText(match[1], "")
  ).filter(Boolean);

  if (quotedMatches.length === 0) {
    return normalizedValue;
  }

  const outsideText = normalizedValue
    .replace(/["'][^"']{2,120}["']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const quotedTitleSignal = /\b(sings|singing|performs|performed|performing|plays|playing|cover|covered|version|live|original)\b/i;

  if (!isDescriptorFragment(outsideText) && !quotedTitleSignal.test(outsideText)) {
    return normalizedValue;
  }

  return quotedMatches.sort((left, right) => right.length - left.length)[0];
}

function stripBracketedDescriptors(value) {
  let currentValue = normalizeTrackText(value, "");
  let changed = true;

  while (changed && currentValue) {
    changed = false;

    currentValue = currentValue.replace(/\s*#[^\s#]+/g, " ").replace(/\s+/g, " ").trim();

    const suffixMatch = currentValue.match(/^(.*)\s[\(\[\{]([^\)\]\}]{1,80})[\)\]\}]\s*$/);
    if (suffixMatch && isDescriptorFragment(suffixMatch[2])) {
      currentValue = normalizeTrackText(suffixMatch[1], "");
      changed = true;
      continue;
    }

    const prefixMatch = currentValue.match(/^\s*[\(\[\{]([^\)\]\}]{1,80})[\)\]\}]\s(.*)$/);
    if (prefixMatch && isDescriptorFragment(prefixMatch[1])) {
      currentValue = normalizeTrackText(prefixMatch[2], "");
      changed = true;
    }
  }

  return currentValue;
}

function stripSeparatedDescriptors(value) {
  const separators = [" - ", " – ", " — ", ": ", " | ", ", ", " / "];
  let currentValue = normalizeTrackText(value, "");
  let changed = true;

  while (changed && currentValue) {
    changed = false;

    for (const separator of separators) {
      if (!currentValue.includes(separator)) {
        continue;
      }

      const parts = currentValue.split(separator);
      if (parts.length < 2) {
        continue;
      }

      const left = normalizeTrackText(parts.slice(0, -1).join(separator), "");
      const right = normalizeTrackText(parts.at(-1), "");

      if (right && isDescriptorFragment(right)) {
        currentValue = left;
        changed = true;
        break;
      }

      if (left && isDescriptorFragment(left)) {
        currentValue = right;
        changed = true;
        break;
      }
    }
  }

  return currentValue;
}

function extractCoreTrackTitle(value) {
  let currentValue = extractQuotedTitle(value);

  currentValue = stripBracketedDescriptors(currentValue);
  currentValue = stripSeparatedDescriptors(currentValue);

  return normalizeTrackText(currentValue, "");
}

function stripArtistPrefixFromTitle(value, artist) {
  const normalizedValue = normalizeTrackText(value, "");
  const normalizedArtist = normalizeTrackText(artist, "");

  if (!normalizedValue || !normalizedArtist) {
    return normalizedValue;
  }

  const lowerValue = normalizedValue.toLowerCase();
  const lowerArtist = normalizedArtist.toLowerCase();

  if (lowerValue === lowerArtist) {
    return normalizedValue;
  }

  for (const separator of [" - ", " – ", " — ", ": ", " | "]) {
    const prefixedArtist = `${lowerArtist}${separator}`;

    if (!lowerValue.startsWith(prefixedArtist)) {
      continue;
    }

    return normalizeTrackText(
      normalizedValue.slice(normalizedArtist.length + separator.length),
      normalizedValue
    );
  }

  return normalizedValue;
}

export function getTrackIdentity(track, options = {}) {
  const {
    titleOnly = false
  } = options;
  const fullTitle = track?.requestedFromTitle || track?.title || "";
  const separatedTitle = splitArtistAndTitle(
    fullTitle
  );
  const rawArtist =
    track?.requestedFromName ||
    track?.sourceName ||
    separatedTitle?.artist ||
    "";
  const sourceStrippedTitle = stripArtistPrefixFromTitle(fullTitle, rawArtist);
  const rawTitle = sourceStrippedTitle !== fullTitle
    ? sourceStrippedTitle
    : stripArtistPrefixFromTitle(
      separatedTitle?.trackTitle || fullTitle,
      rawArtist
    );
  const title = normalizeMatchText(extractCoreTrackTitle(rawTitle));
  const artist = titleOnly ? "" : normalizeMatchText(rawArtist);

  return {
    title,
    artist
  };
}

export function tracksShareIdentity(firstTrack, secondTrack, options = {}) {
  const {
    titleOnly = false
  } = options;
  const firstIdentity = getTrackIdentity(firstTrack, {
    titleOnly
  });
  const secondIdentity = getTrackIdentity(secondTrack, {
    titleOnly
  });

  if (!firstIdentity.title || !secondIdentity.title) {
    return false;
  }

  if (firstIdentity.title !== secondIdentity.title) {
    return false;
  }

  if (firstIdentity.artist && secondIdentity.artist) {
    return firstIdentity.artist === secondIdentity.artist;
  }

  return true;
}
