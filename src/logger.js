function timestamp() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function stringifyDetails(details) {
  if (!details) {
    return "";
  }

  try {
    return ` ${JSON.stringify(details)}`;
  } catch {
    return " [unserializable details]";
  }
}

export function logInfo(message, details) {
  console.log(`[${timestamp()}] INFO ${message}${stringifyDetails(details)}`);
}

export function logWarn(message, details) {
  console.warn(`[${timestamp()}] WARN ${message}${stringifyDetails(details)}`);
}

export function logError(message, details) {
  console.error(`[${timestamp()}] ERROR ${message}${stringifyDetails(details)}`);
}

export function formatTrack(track) {
  if (!track) {
    return null;
  }

  return {
    id: track.id ?? null,
    origin: track.origin ?? null,
    provider: track.provider ?? null,
    title: track.title ?? null,
    url: track.url ?? null
  };
}
