/**
 * Plugin registration logic.
 *
 * Reads config from the OpenClaw Plugin API, validates the API key,
 * creates the Meshimize REST client, instantiates buffers, creates the
 * background WS service, and registers it with the Gateway.
 *
 * Shared state (buffers, pending-join map, WS service) is hoisted to module
 * level so that multiple `register()` calls — as the OpenClaw Gateway does
 * (once for the gateway service, again per agent session) — share the same
 * instances. This ensures WS-received messages are visible to tools across
 * all sessions.
 */

import type { PluginAPI } from "openclaw/plugin-sdk/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig, ConfigValidationError } from "./config.js";
import { MeshimizeAPI } from "./api/client.js";
import { MessageBuffer } from "./buffer/message-buffer.js";
import { DelegationContentBuffer } from "./buffer/delegation-content-buffer.js";
import { createWsService, type WsService } from "./services/ws-manager.js";
import { createPendingJoinMap, PENDING_JOIN_DEFAULTS } from "./state/pending-joins.js";
import { registerGroupTools } from "./tools/groups.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerDirectMessageTools } from "./tools/direct-messages.js";
import { registerDelegationTools } from "./tools/delegations.js";

// ── Module-level singletons ──────────────────────────────────────────────
// Survive across multiple register() calls so the WS service and every
// agent-session tool read/write the same buffer instances.
let sharedMessageBuffer: MessageBuffer | null = null;
let sharedDelegationBuffer: DelegationContentBuffer | null = null;
let sharedPendingJoinMap: ReturnType<typeof createPendingJoinMap> | null = null;
let wsServiceInstance: WsService | null = null;

/**
 * @internal — test use only. Resets module-level singletons.
 */
export function resetSharedState(): void {
  sharedMessageBuffer = null;
  sharedDelegationBuffer = null;
  sharedPendingJoinMap = null;
  wsServiceInstance = null;
}

/**
 * Register the Meshimize plugin with the OpenClaw Gateway.
 *
 * Creates shared deps (REST client, buffers, WS service) on the first call.
 * Subsequent calls reuse the existing singleton instances so that all
 * sessions share the same WS connection and buffer state.
 *
 * The WS service is registered with the Gateway only once.
 * Tools are registered on every call (the Gateway expects per-session
 * tool availability).
 */
export function register(api: PluginAPI): void {
  // Resolve config with full fallback chain:
  // 1. api.pluginConfig (gateway mode) — skip if empty object
  // 2. api.config.plugins.entries.meshimize.config (per-session with full config tree)
  // 3. Best-effort read of ~/.openclaw/openclaw.json from disk, if available
  // 4. {} — final fallback; loadConfig will fail validation unless env vars provide values
  const pluginConfig = api.pluginConfig;
  const hasPluginConfig =
    pluginConfig != null &&
    typeof pluginConfig === "object" &&
    Object.keys(pluginConfig).length > 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const perSessionConfig = (api.config as Record<string, any>)?.plugins?.entries?.meshimize
    ?.config as Record<string, unknown> | undefined;

  let rawConfig: Record<string, unknown>;
  if (hasPluginConfig) {
    rawConfig = pluginConfig as Record<string, unknown>;
  } else if (perSessionConfig && Object.keys(perSessionConfig).length > 0) {
    rawConfig = perSessionConfig;
  } else {
    rawConfig = readConfigFromDisk();
  }

  let config;
  try {
    config = loadConfig(rawConfig);
  } catch (e: unknown) {
    if (e instanceof ConfigValidationError) {
      console.warn(`[meshimize] Plugin registration skipped: ${e.message}`);
      return;
    }
    throw e;
  }

  // Create the REST client (stateless — safe to recreate per session)
  const client = new MeshimizeAPI(config);

  // Lazily initialise shared singletons on first successful registration
  if (!sharedMessageBuffer) {
    sharedMessageBuffer = new MessageBuffer();
  }
  if (!sharedDelegationBuffer) {
    sharedDelegationBuffer = new DelegationContentBuffer();
  }
  if (!sharedPendingJoinMap) {
    sharedPendingJoinMap = createPendingJoinMap(PENDING_JOIN_DEFAULTS);
  }

  // Create and register the background WS service only once.
  // The Gateway calls start() when ready — we do NOT call it here.
  if (!wsServiceInstance) {
    wsServiceInstance = createWsService({
      config,
      api: client,
      messageBuffer: sharedMessageBuffer,
      delegationContentBuffer: sharedDelegationBuffer,
    });
    api.registerService(wsServiceInstance);
  }

  // Register group tools (7 tools) — every call
  registerGroupTools(api, {
    api: client,
    pendingJoins: sharedPendingJoinMap,
    wsService: wsServiceInstance,
  });

  // Register messaging tools (4 tools) — every call
  registerMessageTools(api, { api: client, messageBuffer: sharedMessageBuffer });

  // Register direct message tools (2 tools) — every call
  registerDirectMessageTools(api, { api: client, messageBuffer: sharedMessageBuffer });

  // Register delegation tools (8 tools) — every call
  registerDelegationTools(api, { api: client, delegationBuffer: sharedDelegationBuffer });
}

/**
 * Read Meshimize plugin config from the OpenClaw config file on disk.
 * This is the last-resort fallback when neither api.pluginConfig nor
 * api.config.plugins.entries provides config (e.g., per-session calls
 * where the gateway strips plugin config from community plugins).
 *
 * Reads from `<homedir>/.openclaw/openclaw.json` and extracts
 * `plugins.entries.meshimize.config`.
 *
 * @returns The meshimize config object, or {} if the file doesn't exist
 *          or can't be parsed.
 */
function readConfigFromDisk(): Record<string, unknown> {
  const configPath = join(homedir(), ".openclaw", "openclaw.json");
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meshimizeConfig = (parsed as any)?.plugins?.entries?.meshimize?.config;
    if (meshimizeConfig && typeof meshimizeConfig === "object" && !Array.isArray(meshimizeConfig)) {
      return meshimizeConfig as Record<string, unknown>;
    }
    return {};
  } catch (err: unknown) {
    // ENOENT is expected when the file doesn't exist — fall through silently.
    // Other errors (EACCES, invalid JSON, etc.) indicate a broken config file
    // and deserve a warning so the user can diagnose the real root cause
    // instead of seeing a misleading "API key not configured" message.
    const isEnoent =
      err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
    if (!isEnoent) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[meshimize] Failed to read config from ${configPath}: ${msg}`);
    }
    return {};
  }
}
