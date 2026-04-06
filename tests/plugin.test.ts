import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { definePluginEntry } from "../src/index.js";
import { createMockPluginAPI } from "./__mocks__/openclaw-plugin-sdk/api.js";

// Save and clear env vars to ensure test hermeticity
const ENV_KEYS = ["MESHIMIZE_API_KEY", "MESHIMIZE_BASE_URL", "MESHIMIZE_WS_URL"] as const;
let savedEnv: Record<string, string | undefined>;

describe("plugin", () => {
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

  describe("definePluginEntry", () => {
    it("exports a function", () => {
      expect(typeof definePluginEntry).toBe("function");
    });

    it("does not throw with valid config", () => {
      const api = createMockPluginAPI({ apiKey: "mshz_test123" });
      expect(() => definePluginEntry(api)).not.toThrow();
    });

    it("throws when apiKey is missing from config", () => {
      const api = createMockPluginAPI({});
      expect(() => definePluginEntry(api)).toThrow("API key not configured");
    });
  });

  describe("register", () => {
    it("accepts valid config and creates REST client without error", () => {
      const api = createMockPluginAPI({
        apiKey: "mshz_test123",
        baseUrl: "https://meshimize.fly.dev",
      });
      expect(() => definePluginEntry(api)).not.toThrow();
    });

    it("registers the WS service via api.registerService", () => {
      const api = createMockPluginAPI({
        apiKey: "mshz_test123",
        baseUrl: "https://meshimize.fly.dev",
      });
      definePluginEntry(api);

      expect(api._registeredServices).toHaveLength(1);
      expect(api._registeredServices[0].name).toBe("meshimize-ws");
      expect(typeof api._registeredServices[0].start).toBe("function");
      expect(typeof api._registeredServices[0].stop).toBe("function");
    });
  });
});
