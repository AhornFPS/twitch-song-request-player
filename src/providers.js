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

export function detectProvider(value) {
  if (!isLikelyUrl(value)) {
    return null;
  }

  const url = normalizeUrl(value);
  const hostname = url.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(hostname)) {
    return "youtube";
  }

  if (SOUNDCLOUD_HOSTS.has(hostname)) {
    return "soundcloud";
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

  return rawUrl.trim();
}

function normalizeTrackTitle(value, fallback) {
  const title = typeof value === "string" ? value.trim() : "";

  if (title && title.toLowerCase() !== "undefined" && title.toLowerCase() !== "null") {
    return title;
  }

  return fallback;
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

  return {
    provider: "youtube",
    url,
    title: normalizeTrackTitle(snippet.title, `YouTube video ${videoId}`),
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
    sourceName: typeof snippet.channelTitle === "string" ? snippet.channelTitle.trim() : "",
    sourceUrl: typeof snippet.channelId === "string" && snippet.channelId.trim()
      ? `https://www.youtube.com/channel/${snippet.channelId.trim()}`
      : "",
    isLive: liveBroadcastContent === "live" || liveBroadcastContent === "upcoming"
  };
}

export async function resolveTrackFromUrl(rawUrl, { youtubeApiKey = "" } = {}) {
  const provider = detectProvider(rawUrl);

  if (!provider) {
    throw new Error("Only YouTube and SoundCloud URLs are supported.");
  }

  if (provider === "soundcloud" && !isPlayableSoundCloudUrl(rawUrl)) {
    throw new Error("SoundCloud channel URLs are not playable. Request a specific track URL instead.");
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

    return {
      provider,
      url,
      title: normalizeTrackTitle(metadata.title, `YouTube video ${videoId}`),
      key: `youtube:${videoId}`,
      artworkUrl: metadata.thumbnail_url ?? "",
      durationSeconds: null,
      sourceChannelId: extractYouTubeChannelIdFromUrl(metadata.author_url),
      sourceName: typeof metadata.author_name === "string" ? metadata.author_name.trim() : "",
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
    throw new Error("Please provide a YouTube or SoundCloud link, or a search query.");
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
    return resolveTrackFromUrl(input, {
      youtubeApiKey: options.preferYouTubeApiMetadata ? youtubeApiKey : ""
    });
  }

  if (options.allowSearchRequests === false) {
    throw new Error("Search-based song requests are disabled. Request a direct YouTube or SoundCloud link instead.");
  }

  return searchYouTubeMusic(input, youtubeApiKey, {
    safeSearch: options.youtubeSafeSearch
  });
}
