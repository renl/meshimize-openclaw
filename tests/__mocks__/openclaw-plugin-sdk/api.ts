/**
 * Mock implementation helpers for the OpenClaw Plugin SDK.
 *
 * Provides factory functions to create mock PluginAPI instances for testing.
 */

import type { PluginAPI, ToolDefinition, ServiceDefinition } from "./types.js";

export interface MockPluginAPI extends PluginAPI {
  _registeredTools: ToolDefinition[];
  _registeredServices: ServiceDefinition[];
  _config: Record<string, unknown>;
}

export function createMockPluginAPI(config: Record<string, unknown> = {}): MockPluginAPI {
  const registeredTools: ToolDefinition[] = [];
  const registeredServices: ServiceDefinition[] = [];

  return {
    _registeredTools: registeredTools,
    _registeredServices: registeredServices,
    _config: config,
    id: "meshimize-plugin",
    name: "Meshimize",
    config: {},
    pluginConfig: config,
    registerTool: (tool: ToolDefinition) => {
      registeredTools.push(tool);
    },
    registerService: (service: ServiceDefinition) => {
      registeredServices.push(service);
    },
  };
}

/**
 * Matches the ambient declaration in src/openclaw-plugin-sdk.d.ts for
 * "openclaw/plugin-sdk/api". Ensures that if production code ever imports
 * createPluginAPI via the Vitest alias, it resolves to a working mock.
 */
export function createPluginAPI(config: Record<string, unknown>): PluginAPI {
  return createMockPluginAPI(config);
}
