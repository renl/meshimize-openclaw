/**
 * Mock for openclaw/plugin-sdk/plugin-entry.
 *
 * Simple pass-through: returns the config object as the plugin entry.
 * In real OpenClaw, definePluginEntry wraps the config with SDK internals.
 */
import type { OpenClawPluginApi, OpenClawPluginConfigSchema } from "./types.js";

export interface PluginEntryConfig {
  id: string;
  name: string;
  description: string;
  kind?: string | string[];
  configSchema?: OpenClawPluginConfigSchema | (() => OpenClawPluginConfigSchema);
  register: (api: OpenClawPluginApi) => void;
}

export interface PluginEntry {
  id: string;
  name: string;
  description: string;
  kind?: string | string[];
  configSchema?: OpenClawPluginConfigSchema;
  register: (api: OpenClawPluginApi) => void;
}

export function definePluginEntry(config: PluginEntryConfig): PluginEntry {
  return { ...config };
}
