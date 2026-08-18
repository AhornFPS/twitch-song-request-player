// @ts-nocheck

export const AUTODJ_API_VERSION = "1.0";
export const AUTODJ_API_PREFIX = "/api/v1/autodj";
export const AUTODJ_DEFAULT_LEASE_SECONDS = 90;
export const AUTODJ_MIN_LEASE_SECONDS = 15;
export const AUTODJ_MAX_LEASE_SECONDS = 300;

export function normalizeAutoDjServiceUrl(value) {
  const raw = String(value ?? "").trim().replace(/\/+$/, "");
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return "";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function normalizeAutoDjLeaseSeconds(value, fallback = AUTODJ_DEFAULT_LEASE_SECONDS) {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(AUTODJ_MIN_LEASE_SECONDS, Math.min(AUTODJ_MAX_LEASE_SECONDS, Math.trunc(safe)));
}

export function normalizeAutoDjFadeSeconds(value, fallback = 2) {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(0, Math.min(10, safe));
}

export function isValidCommandIdentity(body) {
  return Boolean(
    body &&
    typeof body.commandId === "string" && body.commandId.trim() &&
    typeof body.clientInstanceId === "string" && body.clientInstanceId.trim() &&
    typeof body.leaseId === "string" && body.leaseId.trim()
  );
}

export function bearerTokenFromRequest(request) {
  const authorization = String(request?.get?.("authorization") ?? "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

