/**
 * Plugin registration logic.
 *
 * Reads config from the OpenClaw Plugin API, validates the API key,
 * creates the Meshimize REST client, and (in later slices) registers tools and services.
 */

import type { PluginAPI } from "openclaw/plugin-sdk/types";
import { loadConfig } from "./config.js";
import { MeshimizeAPI } from "./api/client.js";

/**
 * Register the Meshimize plugin with the OpenClaw Gateway.
 *
 * For Slice 1: validates config and creates the REST client.
 * Tool registration and WebSocket service are added in later slices.
 */
export function register(api: PluginAPI): void {
  const rawConfig = api.getConfig();
  const config = loadConfig(rawConfig);

  // Create the REST client — validates that we can construct it without errors.
  const _client = new MeshimizeAPI(config);

  // Slice 1: Config validation + client creation complete.
  // TODO (Slice 4+): Register 21 tools via api.registerTool(...)
  // TODO (Slice 3): Register WebSocket background service via api.registerService(...)
}
