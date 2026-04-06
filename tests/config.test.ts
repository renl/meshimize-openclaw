import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, ConfigValidationError } from "../src/config.js";

// Save and clear env vars to ensure test hermeticity
const ENV_KEYS = ["MESHIMIZE_API_KEY", "MESHIMIZE_BASE_URL", "MESHIMIZE_WS_URL"] as const;
let savedEnv: Record<string, string | undefined>;

describe("loadConfig", () => {
  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("loads config with valid apiKey", () => {
    const config = loadConfig({ apiKey: "mshz_test123" });
    expect(config.apiKey).toBe("mshz_test123");
    expect(config.baseUrl).toBe("https://api.meshimize.com");
  });

  it("throws ConfigValidationError when apiKey is missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigValidationError);
    expect(() => loadConfig({})).toThrow("API key not configured");
  });

  it("throws ConfigValidationError when apiKey is empty string", () => {
    expect(() => loadConfig({ apiKey: "" })).toThrow(ConfigValidationError);
  });

  it("throws ConfigValidationError when apiKey is not a string", () => {
    expect(() => loadConfig({ apiKey: 123 })).toThrow(ConfigValidationError);
    expect(() => loadConfig({ apiKey: 123 })).toThrow("must be a string");
  });

  it("throws ConfigValidationError when baseUrl is not a string", () => {
    expect(() => loadConfig({ apiKey: "mshz_test123", baseUrl: 42 })).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig({ apiKey: "mshz_test123", baseUrl: 42 })).toThrow("must be a string");
  });

  it("throws ConfigValidationError when wsUrl is not a string", () => {
    expect(() => loadConfig({ apiKey: "mshz_test123", wsUrl: true })).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig({ apiKey: "mshz_test123", wsUrl: true })).toThrow("must be a string");
  });

  it("uses custom baseUrl when provided", () => {
    const config = loadConfig({
      apiKey: "mshz_test123",
      baseUrl: "https://meshimize.fly.dev",
    });
    expect(config.baseUrl).toBe("https://meshimize.fly.dev");
  });

  it("throws for baseUrl with path", () => {
    expect(() =>
      loadConfig({ apiKey: "mshz_test123", baseUrl: "https://example.com/api" }),
    ).toThrow(ConfigValidationError);
    expect(() =>
      loadConfig({ apiKey: "mshz_test123", baseUrl: "https://example.com/api" }),
    ).toThrow("origin-only");
  });

  it("throws for baseUrl with query string", () => {
    expect(() =>
      loadConfig({ apiKey: "mshz_test123", baseUrl: "https://example.com?foo=bar" }),
    ).toThrow(ConfigValidationError);
  });

  it("throws for non-HTTP baseUrl", () => {
    expect(() => loadConfig({ apiKey: "mshz_test123", baseUrl: "ftp://example.com" })).toThrow(
      ConfigValidationError,
    );
  });

  it("derives wsUrl from baseUrl when not provided", () => {
    const config = loadConfig({
      apiKey: "mshz_test123",
      baseUrl: "https://api.meshimize.com",
    });
    expect(config.wsUrl).toBe("wss://api.meshimize.com/api/v1/ws/websocket");
  });

  it("derives ws:// wsUrl from http:// baseUrl", () => {
    const config = loadConfig({
      apiKey: "mshz_test123",
      baseUrl: "http://localhost:4000",
    });
    expect(config.wsUrl).toBe("ws://localhost:4000/api/v1/ws/websocket");
  });

  it("uses explicit wsUrl when provided", () => {
    const config = loadConfig({
      apiKey: "mshz_test123",
      wsUrl: "wss://custom.example.com/ws",
    });
    expect(config.wsUrl).toBe("wss://custom.example.com/ws");
  });

  it("throws for wsUrl with non-WS scheme", () => {
    expect(() => loadConfig({ apiKey: "mshz_test123", wsUrl: "https://example.com/ws" })).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig({ apiKey: "mshz_test123", wsUrl: "https://example.com/ws" })).toThrow(
      "ws:// or wss://",
    );
  });

  it("uses default baseUrl when rawConfig is undefined", () => {
    // beforeEach already cleared env vars; set apiKey for this test
    process.env.MESHIMIZE_API_KEY = "mshz_env_key";
    const config = loadConfig();
    expect(config.apiKey).toBe("mshz_env_key");
    expect(config.baseUrl).toBe("https://api.meshimize.com");
    // afterEach will restore the original env state
  });
});
