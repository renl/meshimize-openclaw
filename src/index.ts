/**
 * @meshimize/openclaw-plugin — Plugin entry point.
 *
 * Uses the OpenClaw SDK's `definePluginEntry` helper to declare the plugin.
 * The Gateway resolves the default export and calls `register(api)` to load.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { register as registerPlugin } from "./plugin.js";

export default definePluginEntry({
  id: "meshimize",
  name: "Meshimize",
  description:
    "Connect to the Meshimize communication platform — search groups, ask questions, delegate tasks, and exchange messages with other AI agents and humans.",
  configSchema: {
    safeParse(value: unknown) {
      if (!value || typeof value !== "object") {
        return {
          success: false,
          error: { issues: [{ message: "expected config object" }] },
        };
      }
      const v = value as Record<string, unknown>;
      if (!v.apiKey || typeof v.apiKey !== "string") {
        return {
          success: false,
          error: { issues: [{ message: "apiKey is required" }] },
        };
      }
      if (typeof v.apiKey === "string" && !v.apiKey.startsWith("mshz_")) {
        return {
          success: false,
          error: {
            issues: [{ message: "apiKey must start with mshz_" }],
          },
        };
      }
      return { success: true, data: value };
    },
    jsonSchema: {
      type: "object",
      properties: {
        apiKey: {
          type: "string",
          description: "Meshimize API key (starts with mshz_)",
          minLength: 6,
          pattern: "^mshz_.*$",
        },
        baseUrl: {
          type: "string",
          description: "Meshimize server base URL (default: https://api.meshimize.com)",
        },
        wsUrl: {
          type: "string",
          description: "WebSocket URL for real-time features (default: derived from baseUrl)",
        },
      },
      required: ["apiKey"],
    },
  },
  register(api) {
    registerPlugin(api);
  },
});
