import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// vi.mock is hoisted above all imports — intercepts readFileSync in both
// this test file and src/plugin.ts. Default mock throws ENOENT for
// .openclaw config paths (hermetic — prevents real ~/.openclaw/openclaw.json
// from leaking into tests) while delegating to the real implementation for
// all other paths (manifest reads, fixtures, etc.).
// Use var (not let/const) to avoid TDZ issues with vi.mock hoisting.
// eslint-disable-next-line no-var
var realReadFileSync: typeof import("node:fs").readFileSync;

/** Default mock: ENOENT for .openclaw paths, real fs for everything else. */
function hermeticReadFileSync(pathArg: string | number | URL, ...rest: unknown[]): unknown {
  if (typeof pathArg === "string" && pathArg.includes(".openclaw")) {
    const err = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  }
  return realReadFileSync(pathArg, ...rest);
}

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  realReadFileSync = actual.readFileSync;
  return {
    ...actual,
    readFileSync: vi.fn(hermeticReadFileSync),
  };
});

import { readFileSync } from "node:fs";
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
    // Reset readFileSync mock to hermetic default after each test
    vi.mocked(readFileSync).mockImplementation(hermeticReadFileSync as typeof readFileSync);
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

    it("registers tools when pluginConfig is {} by falling through to file-based config", () => {
      const validFileConfig = JSON.stringify({
        plugins: {
          entries: {
            meshimize: {
              config: { apiKey: "mshz_from_file" },
            },
          },
        },
      });

      vi.mocked(readFileSync).mockImplementation(((
        pathArg: string | number | URL,
        ...rest: unknown[]
      ) => {
        if (typeof pathArg === "string" && pathArg.includes(".openclaw")) {
          return validFileConfig;
        }
        return realReadFileSync(pathArg, ...rest);
      }) as typeof readFileSync);

      // pluginConfig is {} (empty object) — should NOT be caught by ??
      // and should fall through to file-based config
      const api = createMockPluginAPI({});
      pluginEntry.register(api);

      expect(api._registeredServices).toHaveLength(1);
      expect(api._registeredTools).toHaveLength(21);
    });

    it("reads config from ~/.openclaw/openclaw.json when pluginConfig and perSessionConfig are both empty", () => {
      const validFileConfig = JSON.stringify({
        plugins: {
          entries: {
            meshimize: {
              config: { apiKey: "mshz_disk_fallback" },
            },
          },
        },
      });

      vi.mocked(readFileSync).mockImplementation(((
        pathArg: string | number | URL,
        ...rest: unknown[]
      ) => {
        if (typeof pathArg === "string" && pathArg.includes(".openclaw")) {
          return validFileConfig;
        }
        return realReadFileSync(pathArg, ...rest);
      }) as typeof readFileSync);

      // Both pluginConfig (undefined) and fullConfig ({}) are empty
      const api = createMockPluginAPI(undefined, {});
      pluginEntry.register(api);

      expect(api._registeredServices).toHaveLength(1);
      expect(api._registeredTools).toHaveLength(21);
    });

    it("falls through silently when file-based config file does not exist (ENOENT)", () => {
      // Default mock already throws ENOENT for .openclaw paths — no override needed
      const api = createMockPluginAPI({});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      pluginEntry.register(api);

      // ENOENT is silently ignored — only the loadConfig "API key not configured" warning fires
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("API key not configured"));
      // No file-read warning for ENOENT
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Failed to read config from"),
      );
      expect(api._registeredServices).toHaveLength(0);
      expect(api._registeredTools).toHaveLength(0);

      warnSpy.mockRestore();
    });

    it("warns when file-based config exists but is unreadable (non-ENOENT error)", () => {
      vi.mocked(readFileSync).mockImplementation(((
        pathArg: string | number | URL,
        ...rest: unknown[]
      ) => {
        if (typeof pathArg === "string" && pathArg.includes(".openclaw")) {
          const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
          err.code = "EACCES";
          throw err;
        }
        return realReadFileSync(pathArg, ...rest);
      }) as typeof readFileSync);

      const api = createMockPluginAPI({});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      pluginEntry.register(api);

      // Non-ENOENT errors produce a diagnostic warning including the error detail
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("EACCES: permission denied"));
      // Plus the loadConfig "API key not configured" warning
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("API key not configured"));
      expect(api._registeredServices).toHaveLength(0);
      expect(api._registeredTools).toHaveLength(0);

      warnSpy.mockRestore();
    });

    it("warns when file-based config contains invalid JSON", () => {
      vi.mocked(readFileSync).mockImplementation(((
        pathArg: string | number | URL,
        ...rest: unknown[]
      ) => {
        if (typeof pathArg === "string" && pathArg.includes(".openclaw")) {
          return "{ not valid json !!!";
        }
        return realReadFileSync(pathArg, ...rest);
      }) as typeof readFileSync);

      const api = createMockPluginAPI({});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      pluginEntry.register(api);

      // Invalid JSON produces a diagnostic warning
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to read config from"));
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
