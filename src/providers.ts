// @ts-nocheck
import { tracksShareIdentity } from "./track-identity.js";
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be"
]);

const SOUNDCLOUD_HOSTS = new Set([
  "soundcloud.com",
  "www.soundcloud.com",
  "m.soundcloud.com",
  "on.soundcloud.com"
]);

const SPOTIFY_HOSTS = new Set([
  "open.spotify.com",
  "play.spotify.com",
  "spotify.link"
]);

const SUNO_HOSTS = new Set([
  "suno.com",
  "www.suno.com"
]);

function normalizeUrl(rawUrl) {
  const parsed = new URL(rawUrl.trim());
  parsed.hash = "";
  return parsed;
}

function isLikelyUrl(value) {
  try {
    new URL(value.trim());
    return true;
  } catch {
    return false;
  }
}

function getNormalizedHostname(rawUrl) {
  try {
    return normalizeUrl(rawUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function detectPlayableProvider(value) {
  const hostname = getNormalizedHostname(value);

  if (!hostname) {
    return null;
  }

  if (YOUTUBE_HOSTS.has(hostname)) {
    return "youtube";
  }

  if (SOUNDCLOUD_HOSTS.has(hostname)) {
    return "soundcloud";
  }

  if (SUNO_HOSTS.has(hostname)) {
    return "suno";
  }

  return null;
}

export function detectProvider(value) {
  if (!isLikelyUrl(value)) {
    return null;
  }

  const hostname = getNormalizedHostname(value);

  if (YOUTUBE_HOSTS.has(hostname)) {
    return "youtube";
  }

  if (SOUNDCLOUD_HOSTS.has(hostname)) {
    return "soundcloud";
  }

  if (SPOTIFY_HOSTS.has(hostname)) {
    return "spotify";
  }

  if (SUNO_HOSTS.has(hostname)) {
    return "suno";
  }

  return null;
}

function isPlayableSoundCloudUrl(rawUrl) {
  const url = normalizeUrl(rawUrl);

  if (url.hostname.toLowerCase() === "on.soundcloud.com") {
    return true;
  }

  return url.pathname.split("/").filter(Boolean).length >= 2;
}

function normalizeSpotifyPathSegments(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const pathSegments = url.pathname.split("/").filter(Boolean);

  if (pathSegments[0]?.toLowerCase().startsWith("intl-")) {
    return pathSegments.slice(1);
  }

  return pathSegments;
}

function isPlayableSpotifyUrl(rawUrl) {
  const pathSegments = normalizeSpotifyPathSegments(rawUrl);
  return pathSegments[0]?.toLowerCase() === "track" && Boolean(pathSegments[1]);
}

function isPlayableSunoUrl(rawUrl) {
  const pathSegments = normalizeUrl(rawUrl).pathname.split("/").filter(Boolean);
  return (
    (pathSegments[0]?.toLowerCase() === "song" && Boolean(pathSegments[1])) ||
    (pathSegments[0]?.toLowerCase() === "s" && Boolean(pathSegments[1])) ||
    (pathSegments[0]?.toLowerCase() === "embed" && Boolean(pathSegments[1]))
  );
}

export function extractYouTubeVideoId(rawUrl) {
  let url;

  try {
    url = normalizeUrl(rawUrl);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();

  if (hostname === "youtu.be") {
    return url.pathname.slice(1) || null;
  }

  if (url.searchParams.has("v")) {
    return url.searchParams.get("v");
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);
  const embedIndex = pathSegments.findIndex((segment) => segment === "embed" || segment === "shorts");

  if (embedIndex !== -1) {
    return pathSegments[embedIndex + 1] ?? null;
  }

  return null;
}

export function extractYouTubePlaylistId(rawUrl) {
  let url;

  try {
    url = normalizeUrl(rawUrl);
  } catch {
    return null;
  }

  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const playlistId = url.searchParams.get("list");
  return playlistId?.trim() || null;
}

function extractSpotifyTrackId(rawUrl) {
  try {
    const pathSegments = normalizeSpotifyPathSegments(rawUrl);
    if (pathSegments[0]?.toLowerCase() !== "track") {
      return null;
    }

    return pathSegments[1] ?? null;
  } catch {
    return null;
  }
}

function extractSunoTrackId(rawUrl) {
  try {
    const pathSegments = normalizeUrl(rawUrl).pathname.split("/").filter(Boolean);

    if (
      (pathSegments[0]?.toLowerCase() === "song" || pathSegments[0]?.toLowerCase() === "s" || pathSegments[0]?.toLowerCase() === "embed") &&
      pathSegments[1]
    ) {
      return pathSegments[1];
    }
  } catch {
  }

  return null;
}

export function getTrackKey(provider, rawUrl) {
  if (provider === "youtube") {
    const videoId = extractYouTubeVideoId(rawUrl);
    return videoId ? `youtube:${videoId}` : `youtube:${rawUrl.trim()}`;
  }

  if (provider === "soundcloud") {
    const url = normalizeUrl(rawUrl);
    url.search = "";
    return `soundcloud:${url.toString()}`;
  }

  if (provider === "spotify") {
    const trackId = extractSpotifyTrackId(rawUrl);
    return trackId ? `spotify:${trackId}` : `spotify:${rawUrl.trim()}`;
  }

  if (provider === "suno") {
    const trackId = extractSunoTrackId(rawUrl);
    return trackId ? `suno:${trackId}` : `suno:${rawUrl.trim()}`;
  }

  return rawUrl.trim();
}

function normalizeTrackTitle(value, fallback) {
  const title = typeof value === "string" ? value.trim() : "";

  if (title && title.toLowerCase() !== "undefined" && title.toLowerCase() !== "null") {
    return title;
  }

  return fallback;
}

function hasArtistTitleSeparator(title) {
  return /\s[-–—]\s/.test(title);
}

function buildYouTubeTrackTitle(title, sourceName, fallback) {
  const normalizedTitle = normalizeTrackTitle(title, fallback);
  const normalizedSourceName = normalizeTrackTitle(sourceName, "");

  if (!normalizedTitle || !normalizedSourceName) {
    return normalizedTitle;
  }

  if (hasArtistTitleSeparator(normalizedTitle)) {
    return normalizedTitle;
  }

  if (normalizedTitle.toLowerCase().startsWith(normalizedSourceName.toLowerCase())) {
    return normalizedTitle;
  }

  return `${normalizedSourceName} - ${normalizedTitle}`;
}

function extractYouTubeChannelIdFromUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return "";
  }

  try {
    const url = normalizeUrl(rawUrl);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const channelIndex = pathParts.findIndex((segment) => segment === "channel");

    if (channelIndex !== -1) {
      return pathParts[channelIndex + 1]?.trim() ?? "";
    }
  } catch {
  }

  return "";
}

function parseIso8601DurationToSeconds(duration) {
  if (typeof duration !== "string" || !duration.trim()) {
    return null;
  }

  const match = duration.trim().match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) {
    return null;
  }

  const days = Number.parseInt(match[1] || "0", 10) || 0;
  const hours = Number.parseInt(match[2] || "0", 10) || 0;
  const minutes = Number.parseInt(match[3] || "0", 10) || 0;
  const seconds = Number.parseInt(match[4] || "0", 10) || 0;

  return (days * 86400) + (hours * 3600) + (minutes * 60) + seconds;
}

function chunkItems(items, size) {
  const chunkSize = Math.max(Number.parseInt(String(size), 10) || 1, 1);
  const chunks = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return {
    url: response.url || String(url),
    text: await response.text()
  };
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function extractMetaTagContent(html, name) {
  if (typeof html !== "string" || !html || !name) {
    return "";
  }

  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapeRegex(name)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = html.match(pattern);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function extractLinkHref(html, rel) {
  if (typeof html !== "string" || !html || !rel) {
    return "";
  }

  const pattern = new RegExp(
    `<link[^>]+rel=["']${escapeRegex(rel)}["'][^>]+href=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = html.match(pattern);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function extractDocumentTitle(html) {
  if (typeof html !== "string" || !html) {
    return "";
  }

  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function parseSpotifyDescription(description, fallbackTitle = "") {
  const normalizedDescription = typeof description === "string" ? description.trim() : "";
  const parts = normalizedDescription
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return {
      sourceName: parts[0],
      title: parts[1]
    };
  }

  return {
    sourceName: "",
    title: fallbackTitle
  };
}

function parseSunoDescription(description, fallbackTitle = "") {
  const normalizedDescription = typeof description === "string" ? description.trim() : "";
  const match = normalizedDescription.match(/^(.+?) by (.+?)(?: \(@.+\))?\./i);

  if (!match) {
    return {
      sourceName: "",
      title: fallbackTitle
    };
  }

  return {
    title: match[1]?.trim() || fallbackTitle,
    sourceName: match[2]?.trim() || ""
  };
}

function parseSunoDurationSeconds(html) {
  if (typeof html !== "string" || !html) {
    return null;
  }

  const patterns = [
    /"duration":([0-9]+(?:\.[0-9]+)?)/i,
    /\\"duration\\":([0-9]+(?:\.[0-9]+)?)/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) {
      continue;
    }

    const parsedDuration = Number.parseFloat(match[1]);
    return Number.isFinite(parsedDuration) ? Math.round(parsedDuration) : null;
  }

  return null;
}

function extractSerializedJsonString(html, key) {
  if (typeof html !== "string" || !html || !key) {
    return "";
  }

  const patterns = [
    new RegExp(`"${escapeRegex(key)}":"((?:\\\\.|[^"])*)"`, "i"),
    new RegExp(`\\\\"${escapeRegex(key)}\\\\":\\\\"((?:\\\\\\\\.|[^"])*)\\\\"`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    try {
      return JSON.parse(`"${match[1]}"`);
    } catch {
      return match[1]
        .replaceAll("\\/", "/")
        .replaceAll("\\u0026", "&");
    }
  }

  return "";
}

function buildExternalRequestSearchQuery(track) {
  const parts = [
    typeof track?.sourceName === "string" ? track.sourceName.trim() : "",
    typeof track?.title === "string" ? track.title.trim() : ""
  ].filter(Boolean);

  return parts.join(" - ");
}

function attachResolvedSource(playableTrack, sourceTrack) {
  return {
    ...playableTrack,
    requestedFromProvider: sourceTrack.provider,
    requestedFromUrl: sourceTrack.url,
    requestedFromTitle: sourceTrack.title,
    requestedFromName: sourceTrack.sourceName ?? "",
    requestedFromKey: sourceTrack.key
  };
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMatchTokens(value) {
  return Array.from(new Set(
    normalizeMatchText(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  ));
}

function getTokenCoverage(expectedValue, candidateValue) {
  const expectedTokens = getMatchTokens(expectedValue);

  if (!expectedTokens.length) {
    return 0;
  }

  const candidateTokens = new Set(getMatchTokens(candidateValue));
  let matchedTokens = 0;

  for (const token of expectedTokens) {
    if (candidateTokens.has(token)) {
      matchedTokens += 1;
    }
  }

  return matchedTokens / expectedTokens.length;
}

function splitArtistAndTitle(value) {
  const normalizedValue = normalizeTrackTitle(value, "");
  const match = normalizedValue.match(/^(.+?)\s[-–—]\s(.+)$/);

  if (!match) {
    return null;
  }

  const artist = normalizeTrackTitle(match[1], "");
  const trackTitle = normalizeTrackTitle(match[2], "");

  if (!artist || !trackTitle) {
    return null;
  }

  return {
    artist,
    trackTitle
  };
}

function pushUniqueQuery(queries, value) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";

  if (!normalizedValue || queries.includes(normalizedValue)) {
    return;
  }

  queries.push(normalizedValue);
}

function buildYouTubeRadioQueries(seedTrack) {
  const queries = [];
  const radioSeedInput = typeof seedTrack?.radioSeedInput === "string"
    ? seedTrack.radioSeedInput.trim()
    : "";
  const sourceName = normalizeTrackTitle(
    seedTrack?.requestedFromName || seedTrack?.sourceName,
    ""
  );
  const effectiveTitle = normalizeTrackTitle(
    seedTrack?.requestedFromTitle || seedTrack?.title,
    ""
  );
  const separatedTitle = splitArtistAndTitle(effectiveTitle);
  const artist = sourceName || separatedTitle?.artist || "";
  const trackTitle = separatedTitle?.trackTitle || effectiveTitle;

  if (radioSeedInput && !isLikelyUrl(radioSeedInput)) {
    pushUniqueQuery(queries, `${radioSeedInput} music`);
    pushUniqueQuery(queries, radioSeedInput);
  }

  if (artist && trackTitle) {
    pushUniqueQuery(queries, `${artist} ${trackTitle} radio`);
    pushUniqueQuery(queries, `${artist} ${trackTitle}`);
    pushUniqueQuery(queries, `${artist} similar songs`);
  }

  if (artist) {
    pushUniqueQuery(queries, `${artist} mix`);
    pushUniqueQuery(queries, `${artist} songs`);
  }

  if (trackTitle) {
    pushUniqueQuery(queries, `${trackTitle} music`);
  }

  return queries;
}

function isLikelySameTrack(candidate, seedTrack) {
  const candidateKey = typeof candidate?.key === "string"
    ? candidate.key.trim()
    : typeof candidate?.id?.videoId === "string"
      ? `youtube:${candidate.id.videoId.trim()}`
      : "";

  if (candidateKey && candidateKey === seedTrack?.key) {
    return true;
  }

  if (tracksShareIdentity({
    key: candidateKey,
    title: candidate?.title || candidate?.snippet?.title,
    sourceName: candidate?.sourceName || candidate?.snippet?.channelTitle
  }, seedTrack, {
    titleOnly: true
  })) {
    return true;
  }

  const candidateTitle = normalizeTrackTitle(candidate?.title || candidate?.snippet?.title, "");
  const candidateSource = normalizeTrackTitle(candidate?.sourceName || candidate?.snippet?.channelTitle, "");
  const separatedSeedTitle = splitArtistAndTitle(seedTrack?.requestedFromTitle || seedTrack?.title || "");
  const seedTitle = normalizeTrackTitle(
    separatedSeedTitle?.trackTitle || seedTrack?.requestedFromTitle || seedTrack?.title,
    ""
  );
  const seedSource = normalizeTrackTitle(
    seedTrack?.requestedFromName || seedTrack?.sourceName || separatedSeedTitle?.artist,
    ""
  );

  if (!seedTitle || !candidateTitle) {
    return false;
  }

  const titleCoverage = getTokenCoverage(seedTitle, `${candidateTitle} ${candidateSource}`.trim());
  if (titleCoverage < 1) {
    return false;
  }

  if (!seedSource) {
    return true;
  }

  return getTokenCoverage(seedSource, `${candidateTitle} ${candidateSource}`.trim()) >= 0.5;
}

async function searchYouTubeVideos(query, youtubeApiKey, {
  safeSearch = "none",
  maxResults = 10
} = {}) {
  const trimmedQuery = typeof query === "string" ? query.trim() : "";

  if (!trimmedQuery || !youtubeApiKey) {
    return [];
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(Math.min(Math.max(maxResults, 1), 25)));
  url.searchParams.set("videoCategoryId", "10");
  url.searchParams.set("safeSearch", ["none", "moderate", "strict"].includes(safeSearch) ? safeSearch : "none");
  url.searchParams.set("q", trimmedQuery);
  url.searchParams.set("key", youtubeApiKey);

  const response = await fetchJson(url);
  return Array.isArray(response.items) ? response.items : [];
}

function buildYouTubeTrackFromSearchItem(item) {
  const videoId = typeof item?.id?.videoId === "string" ? item.id.videoId.trim() : "";
  const snippet = item?.snippet ?? {};
  const thumbnails = snippet.thumbnails ?? {};
  const sourceName = typeof snippet.channelTitle === "string" ? snippet.channelTitle.trim() : "";
  const liveBroadcastContent = typeof snippet.liveBroadcastContent === "string"
    ? snippet.liveBroadcastContent.trim().toLowerCase()
    : "none";

  if (!videoId) {
    return null;
  }

  return {
    provider: "youtube",
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: buildYouTubeTrackTitle(snippet.title, sourceName, `YouTube video ${videoId}`),
    key: `youtube:${videoId}`,
    artworkUrl:
      thumbnails.high?.url ??
      thumbnails.medium?.url ??
      thumbnails.default?.url ??
      "",
    durationSeconds: null,
    sourceChannelId: typeof snippet.channelId === "string" ? snippet.channelId.trim() : "",
    sourceName,
    sourceUrl: typeof snippet.channelId === "string" && snippet.channelId.trim()
      ? `https://www.youtube.com/channel/${snippet.channelId.trim()}`
      : "",
    isLive: liveBroadcastContent === "live" || liveBroadcastContent === "upcoming"
  };
}

export async function searchYouTubeMusicResults(query, youtubeApiKey, {
  safeSearch = "none",
  limit = 5
} = {}) {
  const trimmedQuery = typeof query === "string" ? query.trim() : "";
  const normalizedLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 5, 1), 10);

  if (!trimmedQuery) {
    throw new Error("Please provide a YouTube, SoundCloud, Spotify, or Suno link, or a search query.");
  }

  if (!youtubeApiKey) {
    throw new Error("YouTube search requires YOUTUBE_API_KEY in your .env file.");
  }

  const searchItems = await searchYouTubeVideos(trimmedQuery, youtubeApiKey, {
    safeSearch,
    maxResults: normalizedLimit
  });

  if (searchItems.length === 0) {
    throw new Error(`No YouTube music results found for "${trimmedQuery}".`);
  }

  const detailedItems = await fetchYouTubeVideoMetadataItems(
    searchItems
      .map((item) => typeof item?.id?.videoId === "string" ? item.id.videoId.trim() : "")
      .filter(Boolean),
    youtubeApiKey
  );
  const detailedItemsById = new Map(
    detailedItems
      .filter((item) => typeof item?.id === "string" && item.id.trim())
      .map((item) => [item.id.trim(), item])
  );

  const tracks = [];

  for (const item of searchItems) {
    const videoId = typeof item?.id?.videoId === "string" ? item.id.videoId.trim() : "";
    if (!videoId) {
      continue;
    }

    const detailedTrack = detailedItemsById.has(videoId)
      ? buildYouTubeTrackFromVideoApiItem(detailedItemsById.get(videoId), {
        url: `https://www.youtube.com/watch?v=${videoId}`
      })
      : buildYouTubeTrackFromSearchItem(item);

    if (!detailedTrack) {
      continue;
    }

    detailedTrack.artworkUrl =
      detailedTrack.artworkUrl ||
      item.snippet?.thumbnails?.high?.url ||
      item.snippet?.thumbnails?.default?.url ||
      "";

    if (tracks.some((track) => track.key === detailedTrack.key)) {
      continue;
    }

    tracks.push(detailedTrack);

    if (tracks.length >= normalizedLimit) {
      break;
    }
  }

  if (tracks.length === 0) {
    throw new Error(`No YouTube music results found for "${trimmedQuery}".`);
  }

  return tracks;
}

export async function searchSongRequestCandidates(input, youtubeApiKey, options = {}) {
  const trimmedInput = typeof input === "string" ? input.trim() : "";

  if (!trimmedInput) {
    throw new Error("Track input is required.");
  }

  if (isLikelyUrl(trimmedInput)) {
    return [
      await resolveSongRequest(trimmedInput, youtubeApiKey, options)
    ];
  }

  if (options.allowSearchRequests === false) {
    throw new Error("Search-based song requests are disabled. Request a direct YouTube, SoundCloud, Spotify, or Suno link instead.");
  }

  return searchYouTubeMusicResults(trimmedInput, youtubeApiKey, {
    safeSearch: options.youtubeSafeSearch,
    limit: options.limit
  });
}

export async function findYouTubeRadioTracks(seedTrack, youtubeApiKey, {
  safeSearch = "none",
  limit = 3,
  excludeTrackKeys = [],
  isTrackAllowed = null
} = {}) {
  const normalizedLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 3, 1), 10);

  if (!youtubeApiKey) {
    return [];
  }

  const queries = buildYouTubeRadioQueries(seedTrack);
  if (queries.length === 0) {
    return [];
  }

  const excludedKeys = new Set(
    Array.isArray(excludeTrackKeys)
      ? excludeTrackKeys
        .map((trackKey) => typeof trackKey === "string" ? trackKey.trim() : "")
        .filter(Boolean)
      : []
  );

  if (typeof seedTrack?.key === "string" && seedTrack.key.trim()) {
    excludedKeys.add(seedTrack.key.trim());
  }

  const tracks = [];
  const identityExcludedTracks = [seedTrack];

  for (const query of queries) {
    if (tracks.length >= normalizedLimit) {
      break;
    }

    const searchItems = await searchYouTubeVideos(query, youtubeApiKey, {
      safeSearch,
      maxResults: 10
    });
    const candidateVideoIds = searchItems
      .map((item) => typeof item?.id?.videoId === "string" ? item.id.videoId.trim() : "")
      .filter(Boolean);

    if (candidateVideoIds.length === 0) {
      continue;
    }

    const detailedItems = await fetchYouTubeVideoMetadataItems(candidateVideoIds, youtubeApiKey);
    const detailedItemsById = new Map(
      detailedItems
        .filter((item) => typeof item?.id === "string" && item.id.trim())
        .map((item) => [item.id.trim(), item])
    );

    for (const searchItem of searchItems) {
      if (tracks.length >= normalizedLimit) {
        break;
      }

      const videoId = typeof searchItem?.id?.videoId === "string" ? searchItem.id.videoId.trim() : "";
      if (!videoId) {
        continue;
      }

      const trackKey = `youtube:${videoId}`;
      if (excludedKeys.has(trackKey) || isLikelySameTrack(searchItem, seedTrack)) {
        continue;
      }

      const detailedItem = detailedItemsById.get(videoId);
      if (!detailedItem) {
        continue;
      }

      const track = buildYouTubeTrackFromVideoApiItem(detailedItem, {
        url: `https://www.youtube.com/watch?v=${videoId}`
      });
      track.artworkUrl =
        track.artworkUrl ||
        searchItem.snippet?.thumbnails?.high?.url ||
        searchItem.snippet?.thumbnails?.default?.url ||
        "";

      if (
        excludedKeys.has(track.key) ||
        identityExcludedTracks.some((excludedTrack) => isLikelySameTrack(track, excludedTrack))
      ) {
        continue;
      }

      if (typeof isTrackAllowed === "function") {
        const allowed = await isTrackAllowed(track);
        if (!allowed) {
          continue;
        }
      }

      excludedKeys.add(track.key);
      identityExcludedTracks.push(track);
      tracks.push(track);
    }
  }

  return tracks;
}

function scoreExternalYouTubeCandidate(item, expectedTrack) {
  const candidateTitle = typeof item?.snippet?.title === "string" ? item.snippet.title : "";
  const candidateChannelTitle = typeof item?.snippet?.channelTitle === "string" ? item.snippet.channelTitle : "";
  const normalizedCandidateTitle = normalizeMatchText(candidateTitle);
  const normalizedCandidateChannelTitle = normalizeMatchText(candidateChannelTitle);
  const normalizedExpectedTitle = normalizeMatchText(expectedTrack?.title);
  const normalizedExpectedSourceName = normalizeMatchText(expectedTrack?.sourceName);
  const candidateCombined = `${normalizedCandidateTitle} ${normalizedCandidateChannelTitle}`.trim();
  const titleCoverage = getTokenCoverage(normalizedExpectedTitle, candidateCombined);
  const sourceCoverage = getTokenCoverage(normalizedExpectedSourceName, candidateCombined);
  let score = 0;

  if (normalizedExpectedTitle) {
    if (normalizedCandidateTitle === normalizedExpectedTitle) {
      score += 120;
    } else if (candidateCombined.includes(normalizedExpectedTitle)) {
      score += 80;
    }

    score += Math.round(titleCoverage * 60);
  }

  if (normalizedExpectedSourceName) {
    if (normalizedCandidateChannelTitle === normalizedExpectedSourceName) {
      score += 45;
    } else if (
      normalizedCandidateChannelTitle.includes(normalizedExpectedSourceName) ||
      normalizedCandidateTitle.includes(normalizedExpectedSourceName) ||
      candidateCombined.includes(normalizedExpectedSourceName)
    ) {
      score += 25;
    }

    score += Math.round(sourceCoverage * 35);
  }

  if (normalizedExpectedTitle && normalizedExpectedSourceName && titleCoverage >= 1 && sourceCoverage >= 0.5) {
    score += 25;
  }

  return {
    item,
    score,
    titleCoverage,
    sourceCoverage
  };
}

function isAcceptableExternalYouTubeCandidate(match, expectedTrack) {
  if (!match?.item?.id?.videoId) {
    return false;
  }

  const hasExpectedSourceName = Boolean(normalizeMatchText(expectedTrack?.sourceName));

  if (match.titleCoverage >= 1) {
    return true;
  }

  if (hasExpectedSourceName) {
    return match.titleCoverage >= 0.75 && match.sourceCoverage >= 0.5;
  }

  return match.titleCoverage >= 0.75;
}

async function resolveSpotifyTrackFromUrl(rawUrl) {
  if (!isPlayableSpotifyUrl(rawUrl)) {
    throw new Error("Spotify album and playlist URLs are not supported. Request a specific Spotify track URL instead.");
  }

  const { text: html, url: responseUrl } = await fetchText(rawUrl);
  const canonicalUrl = extractLinkHref(html, "canonical") || responseUrl || normalizeUrl(rawUrl).toString();

  if (!isPlayableSpotifyUrl(canonicalUrl)) {
    throw new Error("Spotify album and playlist URLs are not supported. Request a specific Spotify track URL instead.");
  }

  const title = normalizeTrackTitle(
    extractMetaTagContent(html, "og:title") || extractDocumentTitle(html),
    `Spotify track ${extractSpotifyTrackId(canonicalUrl) || ""}`.trim()
  );
  const description = extractMetaTagContent(html, "og:description") || extractMetaTagContent(html, "description");
  const parsedDescription = parseSpotifyDescription(description, title);
  const durationSeconds = Number.parseInt(extractMetaTagContent(html, "music:duration") || "", 10);
  const sourceName = normalizeTrackTitle(
    extractMetaTagContent(html, "music:musician_description") || parsedDescription.sourceName,
    ""
  );

  return {
    provider: "spotify",
    url: canonicalUrl,
    title: normalizeTrackTitle(parsedDescription.title, title),
    key: getTrackKey("spotify", canonicalUrl),
    artworkUrl: extractMetaTagContent(html, "og:image") || "",
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    sourceChannelId: "",
    sourceName,
    sourceUrl: "",
    isLive: false
  };
}

async function resolveSunoTrackFromUrl(rawUrl) {
  if (!isPlayableSunoUrl(rawUrl)) {
    throw new Error("Suno playlist and profile URLs are not supported. Request a specific Suno song URL instead.");
  }

  const { text: html, url: responseUrl } = await fetchText(rawUrl);
  const canonicalUrl = extractLinkHref(html, "canonical") || responseUrl || normalizeUrl(rawUrl).toString();

  if (!isPlayableSunoUrl(canonicalUrl)) {
    throw new Error("Suno playlist and profile URLs are not supported. Request a specific Suno song URL instead.");
  }

  const title = normalizeTrackTitle(
    extractMetaTagContent(html, "og:title"),
    `Suno song ${extractSunoTrackId(canonicalUrl) || ""}`.trim()
  );
  const parsedDescription = parseSunoDescription(extractMetaTagContent(html, "description"), title);
  const audioUrl = extractSerializedJsonString(html, "audio_url");

  if (!audioUrl) {
    throw new Error("This Suno song did not expose a playable audio stream.");
  }

  return {
    provider: "suno",
    url: canonicalUrl,
    title: normalizeTrackTitle(parsedDescription.title, title),
    key: getTrackKey("suno", canonicalUrl),
    artworkUrl: extractMetaTagContent(html, "og:image") || "",
    durationSeconds: parseSunoDurationSeconds(html),
    sourceChannelId: "",
    sourceName: parsedDescription.sourceName,
    sourceUrl: "",
    isLive: false,
    audioUrl
  };
}

export async function resolveYouTubeTrackFromApi(rawUrl, youtubeApiKey) {
  if (!youtubeApiKey) {
    throw new Error("YouTube API key is required to refresh YouTube metadata.");
  }

  const provider = detectProvider(rawUrl);

  if (provider !== "youtube") {
    throw new Error("Only YouTube URLs can be refreshed via the YouTube API.");
  }

  const url = normalizeUrl(rawUrl).toString();
  const videoId = extractYouTubeVideoId(url);

  if (!videoId) {
    throw new Error("Could not extract the YouTube video ID.");
  }

  const item = await fetchYouTubeVideoMetadataItem(videoId, youtubeApiKey);

  if (!item?.id) {
    throw new Error(`No YouTube video metadata found for ${videoId}.`);
  }

  return buildYouTubeTrackFromVideoApiItem(item, {
    url
  });
}

function buildYouTubeTrackFromVideoApiItem(item, { url = "" } = {}) {
  const snippet = item.snippet ?? {};
  const thumbnails = snippet.thumbnails ?? {};
  const contentDetails = item.contentDetails ?? {};
  const liveBroadcastContent = typeof snippet.liveBroadcastContent === "string"
    ? snippet.liveBroadcastContent.trim().toLowerCase()
    : "none";
  const videoId = typeof item.id === "string" ? item.id.trim() : "";
  const sourceName = typeof snippet.channelTitle === "string" ? snippet.channelTitle.trim() : "";

  return {
    provider: "youtube",
    url: url || `https://www.youtube.com/watch?v=${videoId}`,
    title: buildYouTubeTrackTitle(snippet.title, sourceName, `YouTube video ${videoId}`),
    key: `youtube:${videoId}`,
    artworkUrl:
      thumbnails.maxres?.url ??
      thumbnails.standard?.url ??
      thumbnails.high?.url ??
      thumbnails.medium?.url ??
      thumbnails.default?.url ??
      "",
    durationSeconds: parseIso8601DurationToSeconds(contentDetails.duration),
    sourceChannelId: typeof snippet.channelId === "string" ? snippet.channelId.trim() : "",
    sourceName,
    sourceUrl: typeof snippet.channelId === "string" && snippet.channelId.trim()
      ? `https://www.youtube.com/channel/${snippet.channelId.trim()}`
      : "",
    isLive: liveBroadcastContent === "live" || liveBroadcastContent === "upcoming"
  };
}

async function fetchYouTubeVideoMetadataItem(videoId, youtubeApiKey) {
  const items = await fetchYouTubeVideoMetadataItems([videoId], youtubeApiKey);
  return items[0] ?? null;
}

async function fetchYouTubeVideoMetadataItems(videoIds, youtubeApiKey) {
  const normalizedVideoIds = Array.from(
    new Set(
      Array.isArray(videoIds)
        ? videoIds.map((videoId) => typeof videoId === "string" ? videoId.trim() : "").filter(Boolean)
        : []
    )
  );
  const items = [];

  for (const videoIdChunk of chunkItems(normalizedVideoIds, 50)) {
    const apiUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    apiUrl.searchParams.set("part", "snippet,contentDetails,liveStreamingDetails");
    apiUrl.searchParams.set("id", videoIdChunk.join(","));
    apiUrl.searchParams.set("key", youtubeApiKey);

    const response = await fetchJson(apiUrl);
    items.push(...(Array.isArray(response.items) ? response.items : []));
  }

  return items;
}

async function fetchYouTubePlaylistItems(playlistId, youtubeApiKey) {
  const items = [];
  let nextPageToken = "";

  do {
    const apiUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    apiUrl.searchParams.set("part", "snippet,contentDetails,status");
    apiUrl.searchParams.set("playlistId", playlistId);
    apiUrl.searchParams.set("maxResults", "50");
    apiUrl.searchParams.set("key", youtubeApiKey);

    if (nextPageToken) {
      apiUrl.searchParams.set("pageToken", nextPageToken);
    }

    const response = await fetchJson(apiUrl);
    items.push(...(Array.isArray(response.items) ? response.items : []));
    nextPageToken = typeof response.nextPageToken === "string" ? response.nextPageToken : "";
  } while (nextPageToken);

  return items;
}

function buildYouTubePlaylistFallbackTrack({
  videoId,
  title,
  artworkUrl = "",
  sourceChannelId = "",
  sourceName = ""
}) {
  return {
    provider: "youtube",
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: buildYouTubeTrackTitle(title, sourceName, `YouTube video ${videoId}`),
    key: `youtube:${videoId}`,
    artworkUrl,
    durationSeconds: null,
    sourceChannelId,
    sourceName,
    sourceUrl: sourceChannelId ? `https://www.youtube.com/channel/${sourceChannelId}` : "",
    isLive: false
  };
}

export async function resolveYouTubePlaylistFromApi(rawUrl, youtubeApiKey) {
  if (!youtubeApiKey) {
    throw new Error("YouTube API key is required to import YouTube playlists.");
  }

  const provider = detectProvider(rawUrl);

  if (provider !== "youtube") {
    throw new Error("Only YouTube playlist URLs can be imported.");
  }

  const playlistId = extractYouTubePlaylistId(rawUrl);

  if (!playlistId) {
    throw new Error("Provide a YouTube playlist URL with a list= parameter.");
  }

  const playlistUrl = new URL("https://www.googleapis.com/youtube/v3/playlists");
  playlistUrl.searchParams.set("part", "snippet");
  playlistUrl.searchParams.set("id", playlistId);
  playlistUrl.searchParams.set("key", youtubeApiKey);

  const [playlistResponse, playlistItems] = await Promise.all([
    fetchJson(playlistUrl),
    fetchYouTubePlaylistItems(playlistId, youtubeApiKey)
  ]);

  const playlistTitle = normalizeTrackTitle(
    playlistResponse.items?.[0]?.snippet?.title,
    `YouTube playlist ${playlistId}`
  );
  const playlistEntriesByVideoId = new Map();

  for (const item of playlistItems) {
    const snippet = item?.snippet ?? {};
    const contentDetails = item?.contentDetails ?? {};
    const videoId = typeof contentDetails.videoId === "string" && contentDetails.videoId.trim()
      ? contentDetails.videoId.trim()
      : typeof snippet?.resourceId?.videoId === "string" && snippet.resourceId.videoId.trim()
        ? snippet.resourceId.videoId.trim()
        : "";

    if (!videoId || playlistEntriesByVideoId.has(videoId)) {
      continue;
    }

    const thumbnails = snippet.thumbnails ?? {};
    const sourceChannelId = typeof snippet.videoOwnerChannelId === "string" ? snippet.videoOwnerChannelId.trim() : "";
    const sourceName = typeof snippet.videoOwnerChannelTitle === "string" && snippet.videoOwnerChannelTitle.trim()
      ? snippet.videoOwnerChannelTitle.trim()
      : typeof snippet.channelTitle === "string"
        ? snippet.channelTitle.trim()
        : "";

    playlistEntriesByVideoId.set(videoId, {
      videoId,
      title: typeof snippet.title === "string" ? snippet.title.trim() : "",
      artworkUrl:
        thumbnails.maxres?.url ??
        thumbnails.standard?.url ??
        thumbnails.high?.url ??
        thumbnails.medium?.url ??
        thumbnails.default?.url ??
        "",
      sourceChannelId,
      sourceName
    });
  }

  if (playlistEntriesByVideoId.size === 0) {
    throw new Error("This YouTube playlist does not contain any playable videos.");
  }

  const detailedItems = await fetchYouTubeVideoMetadataItems(Array.from(playlistEntriesByVideoId.keys()), youtubeApiKey);
  const videoItemsById = new Map(
    detailedItems
      .filter((item) => typeof item?.id === "string" && item.id.trim())
      .map((item) => [item.id.trim(), item])
  );
  const tracks = [];

  for (const [videoId, entry] of playlistEntriesByVideoId.entries()) {
    const videoItem = videoItemsById.get(videoId);

    if (videoItem) {
      tracks.push(buildYouTubeTrackFromVideoApiItem(videoItem));
      continue;
    }

    tracks.push(buildYouTubePlaylistFallbackTrack(entry));
  }

  return {
    playlistId,
    title: playlistTitle,
    trackCount: playlistEntriesByVideoId.size,
    skippedCount: Math.max(playlistEntriesByVideoId.size - tracks.length, 0),
    tracks
  };
}

export async function resolveTrackFromUrl(rawUrl, { youtubeApiKey = "" } = {}) {
  const provider = detectProvider(rawUrl);

  if (!provider) {
    throw new Error("Only YouTube, SoundCloud, Spotify, and Suno URLs are supported.");
  }

  if (provider === "soundcloud" && !isPlayableSoundCloudUrl(rawUrl)) {
    throw new Error("SoundCloud channel URLs are not playable. Request a specific track URL instead.");
  }

  if (provider === "spotify") {
    return resolveSpotifyTrackFromUrl(rawUrl);
  }

  if (provider === "suno") {
    return resolveSunoTrackFromUrl(rawUrl);
  }

  const url = normalizeUrl(rawUrl).toString();

  if (provider === "youtube") {
    if (youtubeApiKey) {
      return resolveYouTubeTrackFromApi(url, youtubeApiKey);
    }

    const videoId = extractYouTubeVideoId(url);

    if (!videoId) {
      throw new Error("Could not extract the YouTube video ID.");
    }

    const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const metadata = await fetchJson(oEmbedUrl);
    const sourceName = typeof metadata.author_name === "string" ? metadata.author_name.trim() : "";

    return {
      provider,
      url,
      title: buildYouTubeTrackTitle(metadata.title, sourceName, `YouTube video ${videoId}`),
      key: `youtube:${videoId}`,
      artworkUrl: metadata.thumbnail_url ?? "",
      durationSeconds: null,
      sourceChannelId: extractYouTubeChannelIdFromUrl(metadata.author_url),
      sourceName,
      sourceUrl: typeof metadata.author_url === "string" ? metadata.author_url.trim() : "",
      isLive: false
    };
  }

  const oEmbedUrl = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  const metadata = await fetchJson(oEmbedUrl);

  return {
    provider,
    url,
    title: normalizeTrackTitle(metadata.title, "SoundCloud track"),
    key: getTrackKey(provider, url),
    artworkUrl: metadata.thumbnail_url ?? "",
    durationSeconds: null,
    sourceChannelId: "",
    sourceName: typeof metadata.author_name === "string" ? metadata.author_name.trim() : "",
    sourceUrl: typeof metadata.author_url === "string" ? metadata.author_url.trim() : "",
    isLive: false
  };
}

export async function searchYouTubeMusic(query, youtubeApiKey, { safeSearch = "none" } = {}) {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    throw new Error("Please provide a YouTube, SoundCloud, Spotify, or Suno link, or a search query.");
  }

  if (!youtubeApiKey) {
    throw new Error("YouTube search requires YOUTUBE_API_KEY in your .env file.");
  }

  const item = (await searchYouTubeVideos(trimmedQuery, youtubeApiKey, {
    safeSearch,
    maxResults: 1
  }))[0];

  if (!item?.id?.videoId) {
    throw new Error(`No YouTube music result found for "${trimmedQuery}".`);
  }

  const videoId = item.id.videoId;
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const detailedTrack = await resolveYouTubeTrackFromApi(videoUrl, youtubeApiKey);

  return {
    ...detailedTrack,
    title: normalizeTrackTitle(detailedTrack.title, normalizeTrackTitle(item.snippet?.title, trimmedQuery)),
    artworkUrl:
      detailedTrack.artworkUrl ||
      item.snippet?.thumbnails?.high?.url ||
      item.snippet?.thumbnails?.default?.url ||
      ""
  };
}

async function searchYouTubeMusicForExternalTrack(track, youtubeApiKey, { safeSearch = "none" } = {}) {
  const trimmedQuery = buildExternalRequestSearchQuery(track) || track?.title || track?.url || "";

  if (!trimmedQuery.trim()) {
    throw new Error("Could not build a search query for this external track.");
  }

  if (!youtubeApiKey) {
    throw new Error("YouTube search requires YOUTUBE_API_KEY in your .env file.");
  }

  const items = await searchYouTubeVideos(trimmedQuery.trim(), youtubeApiKey, {
    safeSearch,
    maxResults: 10
  });
  const bestMatch = items
    .map((item) => scoreExternalYouTubeCandidate(item, track))
    .sort((left, right) => right.score - left.score)[0];

  if (!bestMatch || !isAcceptableExternalYouTubeCandidate(bestMatch, track)) {
    const providerLabel = track?.provider === "spotify" ? "Spotify" : "Suno";
    throw new Error(`Could not find a close YouTube match for this ${providerLabel} track.`);
  }

  const playableTrack = await resolveYouTubeTrackFromApi(
    `https://www.youtube.com/watch?v=${bestMatch.item.id.videoId}`,
    youtubeApiKey
  );

  return {
    ...playableTrack,
    artworkUrl:
      playableTrack.artworkUrl ||
      bestMatch.item.snippet?.thumbnails?.high?.url ||
      bestMatch.item.snippet?.thumbnails?.default?.url ||
      ""
  };
}

export async function resolveSongRequest(input, youtubeApiKey, options = {}) {
  if (isLikelyUrl(input)) {
    const directTrack = await resolveTrackFromUrl(input, {
      youtubeApiKey: options.preferYouTubeApiMetadata ? youtubeApiKey : ""
    });

    if (directTrack.provider === "spotify") {
      if (!youtubeApiKey) {
        throw new Error(
          "Spotify requests require YOUTUBE_API_KEY so the link can be matched to a playable YouTube track."
        );
      }

      const playableTrack = await searchYouTubeMusicForExternalTrack(
        directTrack,
        youtubeApiKey,
        {
          safeSearch: options.youtubeSafeSearch
        }
      );

      return attachResolvedSource(playableTrack, directTrack);
    }

    return directTrack;
  }

  if (options.allowSearchRequests === false) {
    throw new Error("Search-based song requests are disabled. Request a direct YouTube, SoundCloud, Spotify, or Suno link instead.");
  }

  return searchYouTubeMusic(input, youtubeApiKey, {
    safeSearch: options.youtubeSafeSearch
  });
}
