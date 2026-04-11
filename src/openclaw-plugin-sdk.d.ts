/**
 * Ambient type declarations for the OpenClaw Plugin SDK.
 *
 * The OpenClaw Plugin SDK is host-provided via `openclaw/plugin-sdk/<subpath>`
 * and resolved at runtime by the OpenClaw Gateway's jiti loader.
 * This file provides TypeScript with the type information for compilation.
 *
 * Types below match the real SDK source at github.com/openclaw/openclaw
 * (src/plugins/types.ts + src/plugins/plugin-entry.ts).
 */

declare module "openclaw/plugin-sdk/types" {
  import type { TSchema } from "@sinclair/typebox";

  export interface AgentToolResult {
    content: Array<
      { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
    >;
    details?: unknown;
  }

  export interface AgentTool<TParameters extends TSchema = TSchema> {
    name: string;
    description: string;
    parameters: TParameters;
    execute: (id: string, params: Record<string, unknown>) => Promise<AgentToolResult>;
    ownerOnly?: boolean;
    displaySummary?: string;
  }

  export type OpenClawPluginToolOptions = {
    name?: string;
    names?: string[];
    optional?: boolean;
  };

  export type OpenClawPluginToolFactory = (
    ctx: OpenClawPluginToolContext,
  ) => AgentTool | AgentTool[] | null | undefined;

  export interface OpenClawPluginToolContext {
    config?: Record<string, unknown>;
    workspaceDir?: string;
    agentDir?: string;
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
  }

  export interface OpenClawPluginServiceContext {
    config: Record<string, unknown>;
    workspaceDir?: string;
    stateDir: string;
    logger: PluginLogger;
  }

  export interface PluginLogger {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  }

  export interface OpenClawPluginService {
    id: string;
    start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
    stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
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

  export interface OpenClawPluginApi {
    id: string;
    name: string;
    version?: string;
    description?: string;
    source: string;
    rootDir?: string;
    registrationMode: "full" | "setup-only" | "setup-runtime" | "cli-metadata";
    config: Record<string, unknown>;
    pluginConfig?: Record<string, unknown>;
    logger: PluginLogger;
    registerTool: (
      tool: AgentTool | OpenClawPluginToolFactory,
      opts?: OpenClawPluginToolOptions,
    ) => void;
    registerService: (service: OpenClawPluginService) => void;
    resolvePath: (input: string) => string;
    on: (
      hookName: string,
      handler: (...args: unknown[]) => void,
      opts?: { priority?: number },
    ) => void;
  }

  // Backward-compat aliases used throughout codebase
  export type PluginAPI = OpenClawPluginApi;
  export type ServiceDefinition = OpenClawPluginService;
  export type ToolResult = AgentToolResult;
}

declare module "openclaw/plugin-sdk/plugin-entry" {
  import type { OpenClawPluginApi, OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/types";

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

  export function definePluginEntry(config: PluginEntryConfig): PluginEntry;
}
