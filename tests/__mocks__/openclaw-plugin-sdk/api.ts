/**
 * Mock implementation helpers for the OpenClaw Plugin SDK.
 *
 * Provides factory functions to create mock PluginAPI instances for testing.
 */

import type { OpenClawPluginApi, AgentTool, OpenClawPluginService, PluginAPI } from "./types.js";

export interface MockPluginAPI extends OpenClawPluginApi {
  _registeredTools: AgentTool[];
  _registeredServices: OpenClawPluginService[];
  _config: Record<string, unknown>;
}

export function createMockPluginAPI(
  config?: Record<string, unknown>,
  fullConfig?: Record<string, unknown>,
): MockPluginAPI {
  const registeredTools: AgentTool[] = [];
  const registeredServices: OpenClawPluginService[] = [];

  return {
    _registeredTools: registeredTools,
    _registeredServices: registeredServices,
    _config: config ?? {},
    id: "meshimize-plugin",
    name: "Meshimize",
    config: fullConfig ?? {},
    pluginConfig: config,
    registerTool: (tool: AgentTool) => {
      registeredTools.push(tool);
    },
    registerService: (service: OpenClawPluginService) => {
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
