/**
 * @meshimize/openclaw-plugin — Plugin entry point.
 *
 * Exports `definePluginEntry` which the OpenClaw Gateway calls to load the plugin.
 */

import type { PluginAPI } from "openclaw/plugin-sdk/types";
import { register } from "./plugin.js";

/**
 * OpenClaw plugin entry point.
 * Called by the Gateway to initialize and register plugin capabilities.
 */
export function definePluginEntry(api: PluginAPI): void {
  register(api);
}
