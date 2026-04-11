/**
 * Ambient type declarations for the OpenClaw Plugin SDK.
 *
 * The OpenClaw Plugin SDK is host-provided via `openclaw/plugin-sdk/<subpath>`
 * and resolved at runtime by the OpenClaw Gateway's jiti loader.
 * This file provides TypeScript with the type information for compilation.
 *
 * The real SDK is NOT an npm package — these declarations define the minimal
 * interface the plugin depends on: pluginConfig, registerTool(), registerService().
 */

declare module "openclaw/plugin-sdk/types" {
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
    id: string;
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
}

declare module "openclaw/plugin-sdk/api" {
  export function createPluginAPI(
    config: Record<string, unknown>,
  ): import("openclaw/plugin-sdk/types").PluginAPI;
}

declare module "openclaw/plugin-sdk/plugin-entry" {
  import type { PluginAPI } from "openclaw/plugin-sdk/types";

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

  export function definePluginEntry(config: PluginEntryConfig): PluginEntry;
}
