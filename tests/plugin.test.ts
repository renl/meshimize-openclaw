import { describe, it, expect } from "vitest";
import { definePluginEntry } from "../src/index.js";
import { createMockPluginAPI } from "./__mocks__/openclaw-plugin-sdk/api.js";

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
});
