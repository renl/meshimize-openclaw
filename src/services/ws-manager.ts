/**
 * Background WebSocket connection manager for the OpenClaw plugin.
 *
 * Registered via `api.registerService(...)` per architecture §4.3.
 * Maintains persistent WS connection to the Meshimize server, subscribes
 * to group and account channels, and routes pushed events to local buffers.
 *
 * OpenClaw calls `start()` when the Gateway is ready and `stop()` on shutdown.
 * Process exit handlers (SIGTERM/SIGINT) provide fallback cleanup per OQ-1.
 */

import { PhoenixSocket } from "../ws/client.js";
import type { Channel } from "../ws/channel.js";
import type { MessageBuffer } from "../buffer/message-buffer.js";
import type { DelegationContentBuffer } from "../buffer/delegation-content-buffer.js";
import type { MeshimizeAPI } from "../api/client.js";
import type { Config } from "../config.js";
import type { MessageDataResponse, DirectMessageDataResponse } from "../types/messages.js";
import type { ServiceDefinition } from "openclaw/plugin-sdk/types";

export interface WsManagerDeps {
  config: Config;
  api: MeshimizeAPI;
  messageBuffer: MessageBuffer;
  delegationContentBuffer: DelegationContentBuffer;
}

/**
 * Extended service type that exposes internal methods for tool implementations.
 * Tools (Slice 4+) call subscribeToGroup/unsubscribeFromGroup when the agent joins/leaves groups.
 */
export interface WsService extends ServiceDefinition {
  subscribeToGroup: (groupId: string) => Promise<void>;
  unsubscribeFromGroup: (groupId: string) => Promise<void>;
  getSocket: () => PhoenixSocket | null;
}

export function createWsService(deps: WsManagerDeps): WsService {
  const { config, api, messageBuffer, delegationContentBuffer } = deps;

  let socket: PhoenixSocket | null = null;
  const groupChannels: Map<string, Channel> = new Map();
  const groupMessageHandlers: Map<string, (payload: unknown) => void> = new Map();
  // Retained for future tool slice use (Slice 4+: DM tools may need to access it)
  let _accountChannel: Channel | null = null;
  let shutdownHandlersBound = false;
  let sigTermHandler: (() => void) | null = null;
  let sigIntHandler: (() => void) | null = null;

  async function start(): Promise<void> {
    // Build the WS URL with token and vsn params per architecture §6.4
    const wsUrl = new URL(config.wsUrl);
    wsUrl.searchParams.set("token", config.apiKey);
    wsUrl.searchParams.set("vsn", "2.0.0");
    const wsUrlWithParams = wsUrl.toString();

    socket = new PhoenixSocket(wsUrlWithParams, {
      heartbeatIntervalMs: 30_000,
      reconnectIntervalMs: 1_000, // base interval; PhoenixSocket does linear backoff (interval * attempt)
      maxReconnectAttempts: 10,
      logger: (level, msg) => {
        if (level === "warn") console.warn(`[meshimize-ws] ${msg}`);
        else console.error(`[meshimize-ws] ${msg}`);
      },
    });

    // Wire onStateChange to subscribe initial channels on reconnect (Fix 2)
    let initialChannelsSubscribed = false;

    socket.onStateChange = (state) => {
      if (state === "connected" && !initialChannelsSubscribed) {
        initialChannelsSubscribed = true;
        // Fire and forget — errors are logged inside subscribeInitialChannels
        subscribeInitialChannels().catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(
            `[meshimize-ws] Failed to subscribe initial channels on reconnect: ${errMsg}`,
          );
        });
      }
    };

    // Bind process exit handlers for cleanup (only once).
    // Bound before connect attempt so auto-reconnecting sockets get proper cleanup.
    if (!shutdownHandlersBound) {
      const cleanup = () => {
        stop();
      };
      sigTermHandler = cleanup;
      sigIntHandler = cleanup;
      process.on("SIGTERM", cleanup);
      process.on("SIGINT", cleanup);
      shutdownHandlersBound = true;
    }

    try {
      await socket.connect();
    } catch (err) {
      // Connection failure at startup is non-fatal — the PhoenixSocket will reconnect.
      // Log the error but don't throw — the plugin should still register tools.
      // onStateChange will handle subscription when reconnect succeeds.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[meshimize-ws] Initial connection failed: ${msg}`);
      return;
    }

    // Mark as subscribed before calling — the onStateChange callback won't fire again
    initialChannelsSubscribed = true;
    await subscribeInitialChannels();
  }

  async function subscribeInitialChannels(): Promise<void> {
    if (!socket || socket.getState() !== "connected") return;

    // Get account info for account channel
    try {
      const accountResponse = await api.getAccount();
      const accountId = accountResponse.data.id;

      // Subscribe to account channel for DMs and delegation events
      const acctCh = socket.channel(`account:${accountId}`);
      try {
        await acctCh.join();
        _accountChannel = acctCh;

        // Listen for direct messages (Fix 5: stronger runtime validation)
        acctCh.on("new_direct_message", (payload: unknown) => {
          const msg = payload as Record<string, unknown>;
          if (msg && typeof msg === "object" && typeof msg.id === "string") {
            messageBuffer.addDirectMessage(payload as DirectMessageDataResponse);
          }
        });

        // Listen for delegation events
        acctCh.on("delegation_created", (payload: unknown) => {
          handleDelegationEvent(payload);
        });
        acctCh.on("delegation_updated", (payload: unknown) => {
          handleDelegationEvent(payload);
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[meshimize-ws] Failed to join account channel: ${msg}`);
      }

      // Get groups and subscribe
      const groupsResponse = await api.getMyGroups({ limit: 100 });
      const groups = groupsResponse.data;

      for (const group of groups) {
        await subscribeToGroup(group.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[meshimize-ws] Failed to subscribe to initial channels: ${msg}`);
    }
  }

  async function subscribeToGroup(groupId: string): Promise<void> {
    if (!socket || socket.getState() !== "connected") return;
    if (groupChannels.has(groupId)) return;

    const ch = socket.channel(`group:${groupId}`);
    try {
      await ch.join();
      groupChannels.set(groupId, ch);

      // Store handler reference for cleanup (Fix 4 + Fix 6: stronger runtime validation)
      const messageHandler = (payload: unknown) => {
        const msg = payload as Record<string, unknown>;
        if (msg && typeof msg === "object" && typeof msg.id === "string") {
          messageBuffer.addGroupMessage(groupId, payload as MessageDataResponse);
        }
      };
      ch.on("new_message", messageHandler);
      groupMessageHandlers.set(groupId, messageHandler);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[meshimize-ws] Failed to join group channel ${groupId}: ${errMsg}`);
    }
  }

  async function unsubscribeFromGroup(groupId: string): Promise<void> {
    const ch = groupChannels.get(groupId);
    if (ch) {
      // Remove handler before leaving to prevent accumulation (Fix 4)
      const handler = groupMessageHandlers.get(groupId);
      if (handler) {
        ch.off("new_message", handler);
        groupMessageHandlers.delete(groupId);
      }
      await ch.leave();
      groupChannels.delete(groupId);
      // Remove channel from socket to prevent reuse with stale state
      if (socket) {
        socket.removeChannel(`group:${groupId}`);
      }
      messageBuffer.clearGroup(groupId);
    }
  }

  function handleDelegationEvent(payload: unknown): void {
    const delegation = payload as Record<string, unknown>;
    if (!delegation || typeof delegation !== "object" || typeof delegation.id !== "string") return;

    if (typeof delegation.description === "string") {
      delegationContentBuffer.storeDescription(delegation.id, delegation.description);
    }
    if (typeof delegation.result === "string") {
      delegationContentBuffer.storeResult(delegation.id, delegation.result);
    }
  }

  function stop(): void {
    // Remove signal handlers to prevent listener leaks (Fix 3)
    if (sigTermHandler) {
      process.removeListener("SIGTERM", sigTermHandler);
      sigTermHandler = null;
    }
    if (sigIntHandler) {
      process.removeListener("SIGINT", sigIntHandler);
      sigIntHandler = null;
    }
    shutdownHandlersBound = false;

    if (socket) {
      socket.disconnect();
      socket = null;
    }
    groupChannels.clear();
    groupMessageHandlers.clear();
    _accountChannel = null;
  }

  return {
    name: "meshimize-ws",
    start,
    stop,
    subscribeToGroup,
    unsubscribeFromGroup,
    getSocket: () => socket,
  };
}
