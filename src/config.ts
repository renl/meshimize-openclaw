/**
 * Configuration loading and validation for the Meshimize OpenClaw plugin.
 *
 * Reads from OpenClaw plugin config (api.getConfig()). No zod — uses runtime checks.
 * Falls back to environment variables for testing convenience.
 */

export interface Config {
  apiKey: string;
  baseUrl: string;
  wsUrl: string;
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

/**
 * Load and validate plugin config.
 *
 * @param rawConfig - The raw config object from `api.getConfig()` or equivalent.
 *                    Expected shape: { apiKey?: string, baseUrl?: string, wsUrl?: string }
 *                    Falls back to env vars for fields not present in rawConfig.
 */
export function loadConfig(rawConfig?: Record<string, unknown>): Config {
  // Read apiKey: config object first, then env var fallback.
  // asString() distinguishes "not present" (undefined) from "present but empty" ("").
  // Throws if value is present but wrong type. Only falls back to env var when truly absent.
  const configApiKey = asString(rawConfig?.apiKey, "apiKey");
  const apiKey = configApiKey ?? process.env.MESHIMIZE_API_KEY ?? "";
  if (!apiKey) {
    throw new ConfigValidationError(
      "Meshimize plugin: API key not configured. Set apiKey in your plugin config or set the MESHIMIZE_API_KEY environment variable.",
    );
  }
  if (!apiKey.startsWith("mshz_")) {
    throw new ConfigValidationError('Meshimize plugin: API key must start with "mshz_".');
  }

  // Read baseUrl: config object first, then env var fallback, then default.
  const configBaseUrl = asString(rawConfig?.baseUrl, "baseUrl");
  const rawBaseUrl = configBaseUrl ?? process.env.MESHIMIZE_BASE_URL ?? "https://api.meshimize.com";
  const baseUrl = validateBaseUrl(rawBaseUrl);

  // Read wsUrl: config object first, then env var fallback, then derive from baseUrl.
  // Important: treat an explicitly provided empty string as "present but invalid",
  // not as "absent", so validate whenever rawWsUrl is defined.
  const configWsUrl = asString(rawConfig?.wsUrl, "wsUrl");
  const rawWsUrl = configWsUrl ?? process.env.MESHIMIZE_WS_URL;
  const wsUrl = rawWsUrl !== undefined ? validateWsUrl(rawWsUrl) : deriveWsUrl(baseUrl);

  return { apiKey, baseUrl, wsUrl };
}

/**
 * Safely extract a string from an unknown value.
 * Returns undefined only when the property is absent (undefined/null).
 * Returns "" for explicitly configured empty strings so callers can detect misconfiguration.
 * Throws ConfigValidationError when value is present but not a string (e.g. number, boolean).
 */
function asString(value: unknown, fieldName?: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  throw new ConfigValidationError(
    `Meshimize plugin: ${fieldName ?? "config field"} must be a string, got ${typeof value}.`,
  );
}

/** Validate baseUrl is an origin-only HTTP(S) URL. */
function validateBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigValidationError(
      `Meshimize plugin: Invalid baseUrl "${raw}". Must be a valid HTTP(S) URL.`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigValidationError(
      `Meshimize plugin: baseUrl must use http:// or https:// scheme, got "${url.protocol}".`,
    );
  }

  const isOriginOnly = (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash;
  if (!isOriginOnly) {
    throw new ConfigValidationError(
      `Meshimize plugin: baseUrl must be origin-only (no path, query, or hash), got "${raw}".`,
    );
  }

  // Return normalized URL without trailing slash
  return url.origin;
}

/** Validate wsUrl uses ws:// or wss:// scheme. */
function validateWsUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigValidationError(
      `Meshimize plugin: Invalid wsUrl "${raw}". Must be a valid ws:// or wss:// URL.`,
    );
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new ConfigValidationError(
      `Meshimize plugin: wsUrl must use ws:// or wss:// scheme, got "${url.protocol}".`,
    );
  }

  // Return as-is (includes path like /api/v1/ws/websocket)
  return raw;
}

/** Derive wsUrl from baseUrl per architecture §6.4. */
function deriveWsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/v1/ws/websocket";
  return url.toString().replace(/\/$/, "");
}
