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
import { loadConfig, ConfigValidationError, type Config } from "./config.js";
import { MeshimizeAPI } from "./api/client.js";
import { MessageBuffer } from "./buffer/message-buffer.js";
import { DelegationContentBuffer } from "./buffer/delegation-content-buffer.js";
import { createWsService, type WsService } from "./services/ws-manager.js";
import { createPendingJoinMap, PENDING_JOIN_DEFAULTS } from "./state/pending-joins.js";
import { registerGroupTools } from "./tools/groups.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerDirectMessageTools } from "./tools/direct-messages.js";
import { registerDelegationTools } from "./tools/delegations.js";
import type { RuntimeIdentityContext } from "./types/api.js";
import { errorResult, formatToolError } from "./errors.js";

// ── Module-level singletons ──────────────────────────────────────────────
// Survive across multiple register() calls so the WS service and every
// agent-session tool read/write the same buffer instances.
let sharedMessageBuffer: MessageBuffer | null = null;
let sharedDelegationBuffer: DelegationContentBuffer | null = null;
let sharedPendingJoinMap: ReturnType<typeof createPendingJoinMap> | null = null;
let wsServiceInstance: WsService | null = null;
let runtimeIdentityContext: RuntimeIdentityContext | null = null;
let startupPromise: Promise<RuntimeIdentityContext> | null = null;
let startupError: Error | null = null;
/** Config snapshot from the first successful register() — used to warn on drift. */
let singletonConfig: Config | null = null;

/**
 * @internal — test use only. Returns references to current singletons
 * for identity assertions.
 */
export function getSharedState(): {
  messageBuffer: MessageBuffer | null;
  delegationBuffer: DelegationContentBuffer | null;
  pendingJoinMap: ReturnType<typeof createPendingJoinMap> | null;
  wsService: WsService | null;
  runtimeIdentity: RuntimeIdentityContext | null;
  startupPromise: Promise<RuntimeIdentityContext> | null;
  startupError: Error | null;
} {
  return {
    messageBuffer: sharedMessageBuffer,
    delegationBuffer: sharedDelegationBuffer,
    pendingJoinMap: sharedPendingJoinMap,
    wsService: wsServiceInstance,
    runtimeIdentity: runtimeIdentityContext,
    startupPromise,
    startupError,
  };
}

export function waitForStartup(): Promise<RuntimeIdentityContext | null> {
  return startupPromise ?? Promise.resolve(runtimeIdentityContext);
}

/**
 * @internal — test use only. Tears down and resets module-level singletons.
 * Cleans up owned resources (WS service socket/signal handlers, PendingJoinMap
 * prune interval) before clearing references to avoid leaks.
 */
export function resetSharedState(): void {
  // stop() ignores its context arg (ws-manager.ts uses `_ctx?`); provide
  // a minimal stub that satisfies the OpenClawPluginServiceContext type.
  const noopCtx = {
    config: {},
    stateDir: "",
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  };
  wsServiceInstance?.stop?.(noopCtx);
  sharedPendingJoinMap?.dispose();
  sharedMessageBuffer = null;
  sharedDelegationBuffer = null;
  sharedPendingJoinMap = null;
  wsServiceInstance = null;
  runtimeIdentityContext = null;
  startupPromise = null;
  startupError = null;
  singletonConfig = null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function logResolvedIdentity(resolvedIdentity: RuntimeIdentityContext): void {
  console.info(
    `[meshimize] Connected as ${resolvedIdentity.current_identity.display_name} ` +
      `(identity ${resolvedIdentity.current_identity.id}) under account ` +
      `${resolvedIdentity.account.display_name}.`,
  );
}

function bindClientToStartup(client: MeshimizeAPI): void {
  if (runtimeIdentityContext) {
    client.setRuntimeIdentity(runtimeIdentityContext);
    return;
  }

  if (!startupPromise) {
    return;
  }

  void startupPromise
    .then((resolvedIdentity) => {
      client.setRuntimeIdentity(resolvedIdentity);
    })
    .catch(() => {
      // Shared startup failure is surfaced via the gate.
    });
}

function ensureStartup(client: MeshimizeAPI): Promise<RuntimeIdentityContext> {
  if (runtimeIdentityContext) {
    client.setRuntimeIdentity(runtimeIdentityContext);
    return Promise.resolve(runtimeIdentityContext);
  }

  if (startupError) {
    return Promise.reject(startupError);
  }

  if (!startupPromise) {
    startupPromise = client
      .resolveRuntimeIdentity()
      .then((resolvedIdentity) => {
        runtimeIdentityContext = resolvedIdentity;
        startupError = null;
        client.setRuntimeIdentity(resolvedIdentity);
        logResolvedIdentity(resolvedIdentity);
        return resolvedIdentity;
      })
      .catch((error: unknown) => {
        startupError = toError(error);
        throw startupError;
      });
  }

  bindClientToStartup(client);
  return startupPromise;
}

function createStartupGatedApi(api: PluginAPI, client: MeshimizeAPI): PluginAPI {
  return {
    ...api,
    registerTool(tool, opts) {
      if (typeof tool !== "object" || tool === null || typeof tool.execute !== "function") {
        api.registerTool(tool, opts);
        return;
      }

      api.registerTool(
        {
          ...tool,
          execute: async (id: string, params: Record<string, unknown>) => {
            try {
              await ensureStartup(client);
            } catch (error: unknown) {
              return errorResult(formatToolError(error, client.configBaseUrl));
            }

            return tool.execute(id, params);
          },
        },
        opts,
      );
    },
    registerService(service) {
      api.registerService({
        ...service,
        start: async (ctx) => {
          await ensureStartup(client);
          await service.start(ctx);
        },
      });
    },
  };
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

  let config: Config;
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
  const gatedApi = createStartupGatedApi(api, client);

  void ensureStartup(client).catch(() => {
    // Startup errors are intentionally deferred to the shared gate.
  });

  // Warn if a subsequent register() call uses a different config than the
  // singletons were initialised with.  The WS service keeps using the first
  // config's credentials/URLs, so a mismatch means tools and WS could talk
  // to different servers or authenticate with different keys.
  if (singletonConfig) {
    const drifted: string[] = [];
    if (config.apiKey !== singletonConfig.apiKey) drifted.push("apiKey");
    if (config.baseUrl !== singletonConfig.baseUrl) drifted.push("baseUrl");
    if (config.wsUrl !== singletonConfig.wsUrl) drifted.push("wsUrl");
    if (drifted.length > 0) {
      const verb = drifted.length === 1 ? "differs" : "differ";
      console.warn(
        `[meshimize] Config drift detected on re-registration: ${drifted.join(", ")} ` +
          `${verb} from the initial config used by the WS service. Tools will use the new ` +
          `REST client, but the WS connection retains the original credentials.`,
      );
    }
  }

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
    gatedApi.registerService(wsServiceInstance);
    singletonConfig = config;
  }

  // Register group tools (7 tools) — every call
  registerGroupTools(gatedApi, {
    api: client,
    pendingJoins: sharedPendingJoinMap,
    wsService: wsServiceInstance,
  });

  // Register messaging tools (4 tools) — every call
  registerMessageTools(gatedApi, { api: client, messageBuffer: sharedMessageBuffer });

  // Register direct message tools (2 tools) — every call
  registerDirectMessageTools(gatedApi, { api: client, messageBuffer: sharedMessageBuffer });

  // Register delegation tools (8 tools) — every call
  registerDelegationTools(gatedApi, { api: client, delegationBuffer: sharedDelegationBuffer });
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
