export type YouTubeApiCheckStatus =
  | "valid" | "missing" | "malformed" | "invalid" | "api_disabled"
  | "referrer_blocked" | "ip_blocked" | "app_blocked" | "api_blocked"
  | "quota_exceeded" | "rate_limited" | "forbidden" | "timeout"
  | "network_error" | "service_error";

export interface YouTubeApiCheckResult {
  status: YouTubeApiCheckStatus;
  message: string;
}

function result(status: YouTubeApiCheckStatus, message: string): YouTubeApiCheckResult {
  return { status, message };
}

function describeFailure(status: number, payload: any): YouTubeApiCheckResult {
  const error = payload?.error;
  const reasons = [
    ...(Array.isArray(error?.errors) ? error.errors : []),
    ...(Array.isArray(error?.details) ? error.details : [])
  ].map(entry => String(entry?.reason ?? "").replaceAll("_", "").toLowerCase());
  const has = (...values: string[]) => values.some(value => reasons.includes(value));
  // Read Google's text only to classify older errors. Never return it: it can contain credentials.
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";

  if (has("keyinvalid", "keyexpired", "apikeyinvalid", "apikeyexpired", "apikeynotfound") || /api key (not valid|is invalid|has expired)/.test(message)) {
    return result("invalid", "Google rejected this API key. Copy an active API key from Google Cloud Credentials; do not use an OAuth client ID or client secret.");
  }
  if (has("accessnotconfigured", "servicedisabled") || /youtube data api.*(disabled|has not been used)/.test(message)) {
    return result("api_disabled", "YouTube Data API v3 is disabled or has not been enabled for this key's Google Cloud project. Enable it in APIs & Services, wait a few minutes, then check again.");
  }
  if (has("apikeyhttpreferrerblocked") || /refer(r)?er.*blocked/.test(message)) {
    return result("referrer_blocked", "Website/referrer restrictions block this key. Music Control Center calls YouTube from its server, without a website referrer. Use a key configured for server requests and keep its API restriction set to YouTube Data API v3.");
  }
  if (has("apikeyipaddressblocked") || /ip address.*blocked/.test(message)) {
    return result("ip_blocked", "This key's IP restrictions block the Music Control Center server. Allow the public outbound IP of the computer running Music Control Center in Google Cloud Credentials, then check again.");
  }
  if (has("apikeyserviceblocked", "apikeymethodblocked")) {
    return result("api_blocked", "This key's API restrictions block YouTube. Allow YouTube Data API v3 in Google Cloud Credentials, then check again.");
  }
  if (has("apikeyandroidappblocked", "apikeyiosappblocked")) {
    return result("app_blocked", "This key is restricted to a mobile app. Use a key configured for server requests with YouTube Data API v3 allowed.");
  }
  if (has("quotaexceeded", "dailylimitexceeded", "dailylimitexceededunreg") || /quota.*exceed|daily limit.*exceed/.test(message)) {
    return result("quota_exceeded", "YouTube API quota is exhausted. Check this project's YouTube Data API v3 quotas in Google Cloud and retry after the quota resets. This does not mean the key is invalid.");
  }
  if (status === 429 || has("ratelimitexceeded", "userratelimitexceeded")) {
    return result("rate_limited", "Google is limiting requests. Wait and try again; check the project's YouTube Data API v3 quotas if this continues. The key's validity could not be confirmed.");
  }
  if (status === 401 || status === 403) {
    return result("forbidden", "Google denied access. Check that YouTube Data API v3 is enabled in this key's project and that the key's API and application restrictions allow requests from the Music Control Center server.");
  }
  return result("service_error", "YouTube returned an unexpected response. Try again later. The key's validity could not be confirmed.");
}

export async function checkYouTubeApiKey(
  rawKey: string,
  { fetchImpl = fetch, timeoutMs = 10_000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<YouTubeApiCheckResult> {
  const key = rawKey.trim();
  if (!key) {
    return result("missing", "No YouTube API key entered. Add a key to enable text searches, Spotify matching, playlist imports, and metadata repair. Direct links can still be used without one.");
  }
  if (key.length > 256 || !/^[A-Za-z0-9_-]+$/.test(key)) {
    return result("malformed", "The API key contains unexpected characters. Paste only the key from Google Cloud Credentials, without quotes, spaces, a URL, or a key= prefix.");
  }

  // One videos.list request (1 quota unit), from the same server as real lookups.
  // An empty items list is also valid: this check does not depend on video availability.
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "id");
  url.searchParams.set("id", "jNQXAC9IVRw");
  url.searchParams.set("fields", "kind,items(id)");
  url.searchParams.set("key", key);
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(url, { signal, redirect: "error" });
    let payload: any;
    try {
      payload = await response.json();
    } catch (error) {
      if (signal.aborted) throw error;
      return describeFailure(response.status, null);
    }
    if (!response.ok || payload?.error) return describeFailure(response.status, payload);
    if (payload?.kind !== "youtube#videoListResponse" || !Array.isArray(payload.items)) {
      return describeFailure(response.status, null);
    }
    return result("valid", "Key accepted. YouTube Data API v3 is reachable from this Music Control Center server. This checks metadata access; search has a separate quota limit.");
  } catch (error) {
    if (signal.aborted || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))) {
      return result("timeout", "The YouTube API check timed out. Check the server's internet connection and try again. The key's validity could not be confirmed.");
    }
    return result("network_error", "Could not reach YouTube. Check the server's internet connection, firewall, or proxy and try again. The key's validity could not be confirmed.");
  }
}
