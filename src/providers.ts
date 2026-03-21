// @ts-nocheck
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

  const match = html.match(/"duration":([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) {
    return null;
  }

  const parsedDuration = Number.parseFloat(match[1]);
  return Number.isFinite(parsedDuration) ? Math.round(parsedDuration) : null;
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
    isLive: false
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

  const apiUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  apiUrl.searchParams.set("part", "snippet,contentDetails,liveStreamingDetails");
  apiUrl.searchParams.set("id", videoId);
  apiUrl.searchParams.set("key", youtubeApiKey);

  const response = await fetchJson(apiUrl);
  const item = response.items?.[0];

  if (!item?.id) {
    throw new Error(`No YouTube video metadata found for ${videoId}.`);
  }

  const snippet = item.snippet ?? {};
  const thumbnails = snippet.thumbnails ?? {};
  const contentDetails = item.contentDetails ?? {};
  const liveBroadcastContent = typeof snippet.liveBroadcastContent === "string"
    ? snippet.liveBroadcastContent.trim().toLowerCase()
    : "none";
  const sourceName = typeof snippet.channelTitle === "string" ? snippet.channelTitle.trim() : "";

  return {
    provider: "youtube",
    url,
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

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("videoCategoryId", "10");
  url.searchParams.set("safeSearch", ["none", "moderate", "strict"].includes(safeSearch) ? safeSearch : "none");
  url.searchParams.set("q", trimmedQuery);
  url.searchParams.set("key", youtubeApiKey);

  const response = await fetchJson(url);
  const item = response.items?.[0];

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

export async function resolveSongRequest(input, youtubeApiKey, options = {}) {
  if (isLikelyUrl(input)) {
    const directTrack = await resolveTrackFromUrl(input, {
      youtubeApiKey: options.preferYouTubeApiMetadata ? youtubeApiKey : ""
    });

    if (directTrack.provider === "spotify" || directTrack.provider === "suno") {
      if (!youtubeApiKey) {
        const providerLabel = directTrack.provider === "spotify" ? "Spotify" : "Suno";
        throw new Error(
          `${providerLabel} requests require YOUTUBE_API_KEY so the link can be matched to a playable YouTube track.`
        );
      }

      const playableTrack = await searchYouTubeMusic(
        buildExternalRequestSearchQuery(directTrack) || directTrack.title || directTrack.url,
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
