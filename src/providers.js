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
  apiUrl.searchParams.set("part", "snippet");
  apiUrl.searchParams.set("id", videoId);
  apiUrl.searchParams.set("key", youtubeApiKey);

  const response = await fetchJson(apiUrl);
  const item = response.items?.[0];

  if (!item?.id) {
    throw new Error(`No YouTube video metadata found for ${videoId}.`);
  }

  const snippet = item.snippet ?? {};
  const thumbnails = snippet.thumbnails ?? {};

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
      ""
  };
}

export async function resolveTrackFromUrl(rawUrl) {
  const provider = detectProvider(rawUrl);

  if (!provider) {
    throw new Error("Only YouTube and SoundCloud URLs are supported.");
  }

  if (provider === "soundcloud" && !isPlayableSoundCloudUrl(rawUrl)) {
    throw new Error("SoundCloud channel URLs are not playable. Request a specific track URL instead.");
  }

  const url = normalizeUrl(rawUrl).toString();

  if (provider === "youtube") {
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
      artworkUrl: metadata.thumbnail_url ?? ""
    };
  }

  const oEmbedUrl = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  const metadata = await fetchJson(oEmbedUrl);

  return {
    provider,
    url,
    title: normalizeTrackTitle(metadata.title, "SoundCloud track"),
    key: getTrackKey(provider, url),
    artworkUrl: metadata.thumbnail_url ?? ""
  };
}

export async function searchYouTubeMusic(query, youtubeApiKey) {
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
  url.searchParams.set("safeSearch", "none");
  url.searchParams.set("q", trimmedQuery);
  url.searchParams.set("key", youtubeApiKey);

  const response = await fetchJson(url);
  const item = response.items?.[0];

  if (!item?.id?.videoId) {
    throw new Error(`No YouTube music result found for "${trimmedQuery}".`);
  }

  const videoId = item.id.videoId;
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  return {
    provider: "youtube",
    url: videoUrl,
    title: normalizeTrackTitle(item.snippet?.title, trimmedQuery),
    key: `youtube:${videoId}`,
    artworkUrl: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url ?? ""
  };
}

export async function resolveSongRequest(input, youtubeApiKey) {
  if (isLikelyUrl(input)) {
    return resolveTrackFromUrl(input);
  }

  return searchYouTubeMusic(input, youtubeApiKey);
}
