/**
 * Plugin registration logic.
 *
 * Reads config from the OpenClaw Plugin API, validates the API key,
 * creates the Meshimize REST client, instantiates buffers, creates the
 * background WS service, and registers it with the Gateway.
 */

import type { PluginAPI } from "openclaw/plugin-sdk/types";
import { loadConfig } from "./config.js";
import { MeshimizeAPI } from "./api/client.js";
import { MessageBuffer } from "./buffer/message-buffer.js";
import { DelegationContentBuffer } from "./buffer/delegation-content-buffer.js";
import { createWsService } from "./services/ws-manager.js";
import { createPendingJoinMap, PENDING_JOIN_DEFAULTS } from "./state/pending-joins.js";
import { registerGroupTools } from "./tools/groups.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerDirectMessageTools } from "./tools/direct-messages.js";
import { registerDelegationTools } from "./tools/delegations.js";

/**
 * Register the Meshimize plugin with the OpenClaw Gateway.
 *
 * Creates deps (REST client, buffers), creates and registers the background
 * WebSocket service. The Gateway calls service.start() when ready.
 * Registers all 21 tools across 4 modules.
 */
export function register(api: PluginAPI): void {
  const rawConfig = api.getConfig();
  const config = loadConfig(rawConfig);

  // Create the REST client
  const client = new MeshimizeAPI(config);

  // Create message and delegation content buffers
  const messageBuffer = new MessageBuffer();
  const delegationContentBuffer = new DelegationContentBuffer();

  // Create and register the background WS service.
  // The Gateway calls start() when ready — we do NOT call it here.
  const wsService = createWsService({
    config,
    api: client,
    messageBuffer,
    delegationContentBuffer,
  });

  api.registerService(wsService);

  // Create pending join map for operator-gated join flow
  const pendingJoins = createPendingJoinMap(PENDING_JOIN_DEFAULTS);

  // Register group tools (7 tools)
  registerGroupTools(api, { api: client, pendingJoins, wsService });

  // Register messaging tools (4 tools)
  registerMessageTools(api, { api: client, messageBuffer });

  // Register direct message tools (2 tools)
  registerDirectMessageTools(api, { api: client, messageBuffer });

  // Register delegation tools (8 tools)
  registerDelegationTools(api, { api: client, delegationBuffer: delegationContentBuffer });
}
