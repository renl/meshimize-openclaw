/**
 * Mock types for the OpenClaw Plugin SDK.
 *
 * These mock the host-provided `openclaw/plugin-sdk/types` module
 * for testing purposes. The real SDK is resolved at runtime by the
 * OpenClaw Gateway's jiti loader.
 *
 * Updated to match real SDK interfaces: AgentTool, AgentToolResult,
 * OpenClawPluginService, OpenClawPluginApi, OpenClawPluginServiceContext.
 */

export interface AgentToolResult {
  content: Array<{ type: string; text: string }>;
  details?: unknown;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (id: string, params: Record<string, unknown>) => Promise<AgentToolResult>;
}

export interface PluginLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export interface OpenClawPluginServiceContext {
  logger: PluginLogger;
}

export interface OpenClawPluginService {
  id: string;
  start: (ctx?: OpenClawPluginServiceContext) => Promise<void> | void;
  stop?: (ctx?: OpenClawPluginServiceContext) => Promise<void> | void;
}

export interface OpenClawPluginApi {
  id: string;
  name: string;
  config: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  registerTool: (tool: AgentTool) => void;
  registerService: (service: OpenClawPluginService) => void;
}

export interface OpenClawPluginConfigSchema {
  safeParse?: (value: unknown) => {
    success: boolean;
    data?: unknown;
    error?: {
      issues?: Array<{
        path?: Array<string | number>;
        message: string;
      }>;
    };
  };
  parse?: (value: unknown) => unknown;
  validate?: (value: unknown) => { ok: true; value?: unknown } | { ok: false; errors: string[] };
  uiHints?: Record<string, unknown>;
  jsonSchema?: Record<string, unknown>;
}

// Backward-compat aliases
export type PluginAPI = OpenClawPluginApi;
export type ServiceDefinition = OpenClawPluginService;
export type ToolDefinition = AgentTool;
export type ToolResult = AgentToolResult;
