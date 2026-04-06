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

/**
 * Register the Meshimize plugin with the OpenClaw Gateway.
 *
 * Creates deps (REST client, buffers), creates and registers the background
 * WebSocket service. The Gateway calls service.start() when ready.
 * Tool registration is added in Slice 4+.
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

  // TODO (Slice 4+): Register 21 tools via api.registerTool(...)
  // Tools will need: client, messageBuffer, delegationContentBuffer, wsService
}
