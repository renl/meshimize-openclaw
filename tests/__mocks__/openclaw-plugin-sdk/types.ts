/**
 * Mock types for the OpenClaw Plugin SDK.
 *
 * These mock the host-provided `openclaw/plugin-sdk/types` module
 * for testing purposes. The real SDK is resolved at runtime by the
 * OpenClaw Gateway's jiti loader.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface ServiceDefinition {
  name: string;
  start: () => Promise<void> | void;
  stop?: () => Promise<void> | void;
}

export interface PluginAPI {
  id: string;
  name: string;
  config: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  registerTool: (tool: ToolDefinition) => void;
  registerService: (service: ServiceDefinition) => void;
}
