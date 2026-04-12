import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pluginEntry from "../src/index.js";
import { createMockPluginAPI } from "./__mocks__/openclaw-plugin-sdk/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "../openclaw.plugin.json"), "utf-8"),
) as { id: string; name: string; description: string; configSchema?: Record<string, unknown> };

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

  describe("pluginEntry structure", () => {
    it("is a valid plugin entry object", () => {
      expect(pluginEntry).toBeDefined();
      expect(pluginEntry.id).toBe(manifest.id);
      expect(pluginEntry.name).toBe(manifest.name);
      expect(pluginEntry.description).toBe(manifest.description);
      expect(typeof pluginEntry.register).toBe("function");
    });

    it("has the correct id matching openclaw.plugin.json", () => {
      expect(pluginEntry.id).toBe(manifest.id);
    });

    it("includes configSchema with safeParse and jsonSchema matching openclaw.plugin.json", () => {
      expect(pluginEntry.configSchema).toBeDefined();
      expect(typeof pluginEntry.configSchema!.safeParse).toBe("function");
      expect(pluginEntry.configSchema!.jsonSchema).toEqual(manifest.configSchema);
    });
  });

  describe("register", () => {
    it("does not throw with valid config", () => {
      const api = createMockPluginAPI({ apiKey: "mshz_test123" });
      expect(() => pluginEntry.register(api)).not.toThrow();
    });

    it("does not throw when apiKey is missing from config", () => {
      const api = createMockPluginAPI({});
      expect(() => pluginEntry.register(api)).not.toThrow();
    });

    it("logs warning and returns early when config is missing", () => {
      const api = createMockPluginAPI({});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      pluginEntry.register(api);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[meshimize]"));
      expect(api._registeredServices).toHaveLength(0);
      expect(api._registeredTools).toHaveLength(0);

      warnSpy.mockRestore();
    });

    it("does not register tools or services when config validation fails", () => {
      const api = createMockPluginAPI({ apiKey: "invalid_key" });
      pluginEntry.register(api);

      expect(api._registeredServices).toHaveLength(0);
      expect(api._registeredTools).toHaveLength(0);
    });

    it("accepts valid config and creates REST client without error", () => {
      const api = createMockPluginAPI({
        apiKey: "mshz_test123",
        baseUrl: "https://meshimize.fly.dev",
      });
      expect(() => pluginEntry.register(api)).not.toThrow();
    });

    it("registers the WS service via api.registerService", () => {
      const api = createMockPluginAPI({
        apiKey: "mshz_test123",
        baseUrl: "https://meshimize.fly.dev",
      });
      pluginEntry.register(api);

      expect(api._registeredServices).toHaveLength(1);
      expect(api._registeredServices[0].id).toBe("meshimize-ws");
      expect(typeof api._registeredServices[0].start).toBe("function");
      expect(typeof api._registeredServices[0].stop).toBe("function");
    });

    it("registers tools when pluginConfig is undefined but config.plugins.entries.meshimize.config has valid config", () => {
      const api = createMockPluginAPI(undefined, {
        plugins: {
          entries: {
            meshimize: {
              config: { apiKey: "mshz_test123" },
            },
          },
        },
      });

      pluginEntry.register(api);

      // Should have resolved config from the per-session fallback path
      expect(api._registeredServices).toHaveLength(1);
      expect(api._registeredTools.length).toBeGreaterThan(0);
      expect(api._registeredTools).toHaveLength(21);
    });

    it("logs warning when both pluginConfig and config.plugins.entries.meshimize.config are absent", () => {
      const api = createMockPluginAPI(undefined, {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      pluginEntry.register(api);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[meshimize]"));
      expect(api._registeredServices).toHaveLength(0);
      expect(api._registeredTools).toHaveLength(0);

      warnSpy.mockRestore();
    });
  });

  describe("configSchema.safeParse", () => {
    it("safeParse accepts object without apiKey", () => {
      const result = pluginEntry.configSchema!.safeParse({});
      expect(result.success).toBe(true);
    });

    it("safeParse rejects non-object values", () => {
      const result = pluginEntry.configSchema!.safeParse("not-an-object");
      expect(result.success).toBe(false);
    });
  });
});
