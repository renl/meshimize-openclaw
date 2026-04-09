/**
 * Mock for openclaw/plugin-sdk/plugin-entry.
 *
 * Simple pass-through: returns the config object as the plugin entry.
 * In real OpenClaw, definePluginEntry wraps the config with SDK internals.
 */
import type { PluginAPI } from "./types.js";

export interface PluginEntryConfig {
  id: string;
  name: string;
  description: string;
  kind?: string;
  configSchema?: Record<string, unknown> | (() => Record<string, unknown>);
  register: (api: PluginAPI) => void;
}

export interface PluginEntry {
  id: string;
  name: string;
  description: string;
  kind?: string;
  configSchema?: Record<string, unknown> | (() => Record<string, unknown>);
  register: (api: PluginAPI) => void;
}

export function definePluginEntry(config: PluginEntryConfig): PluginEntry {
  return { ...config };
}
