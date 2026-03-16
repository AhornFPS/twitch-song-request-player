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

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
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
      title: metadata.title?.trim() || `YouTube video ${videoId}`,
      key: `youtube:${videoId}`,
      artworkUrl: metadata.thumbnail_url ?? ""
    };
  }

  const oEmbedUrl = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  const metadata = await fetchJson(oEmbedUrl);

  return {
    provider,
    url,
    title: metadata.title?.trim() || "SoundCloud track",
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
    title: item.snippet?.title?.trim() || trimmedQuery,
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
