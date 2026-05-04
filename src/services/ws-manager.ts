/**
 * Background WebSocket connection manager for the OpenClaw plugin.
 *
 * Registered via `api.registerService(...)` per architecture §4.3.
 * Maintains persistent WS connection to the Meshimize server, subscribes
 * to group and identity channels, and routes pushed events to local buffers.
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
import type { RuntimeIdentityContext } from "../types/api.js";
import type { MessageDataResponse, DirectMessageDataResponse } from "../types/messages.js";
import type {
  OpenClawPluginService,
  OpenClawPluginServiceContext,
} from "openclaw/plugin-sdk/types";

export interface WsManagerDeps {
  config: Config;
  api: MeshimizeAPI;
  messageBuffer: MessageBuffer;
  delegationContentBuffer: DelegationContentBuffer;
  runtimeIdentity?: RuntimeIdentityContext;
}

/**
 * Extended service type that exposes internal methods for tool implementations.
 * Tools (Slice 4+) call subscribeToGroup/unsubscribeFromGroup when the agent joins/leaves groups.
 */
export interface WsService extends OpenClawPluginService {
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
  let _identityChannel: Channel | null = null;
  // Account channel handler references — stored for cleanup on reconnect (Issue A)
  let accountDmHandler: ((payload: unknown) => void) | null = null;
  let accountDelegationCreatedHandler: ((payload: unknown) => void) | null = null;
  let accountDelegationUpdatedHandler: ((payload: unknown) => void) | null = null;
  let shutdownHandlersBound = false;
  let sigTermHandler: (() => void) | null = null;
  let sigIntHandler: (() => void) | null = null;

  async function start(_ctx?: OpenClawPluginServiceContext): Promise<void> {
    // Guard against double-start: stop existing socket before creating a new one (PR review R2)
    if (socket) {
      stop();
    }

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

    // Track whether the initial channel subscription path has been triggered.
    // Prevents duplicate subscribeInitialChannels() on the first connect:
    // onStateChange fires synchronously during connect(), before connect()'s
    // promise resolves and before the post-connect subscribeInitialChannels() call.
    // On initial failure, the catch block sets this flag so that onStateChange
    // can subscribe on the first successful reconnect.
    let subscriptionTriggered = false;

    socket.onStateChange = (state) => {
      if (state !== "connected") return;

      // Skip the first successful connection — handled by the post-connect block below.
      // subscriptionTriggered is false until either: (a) post-connect sets it after
      // await subscribeInitialChannels(), or (b) the catch block sets it on initial failure.
      if (!subscriptionTriggered) return;

      // This is a reconnect (or first connect after initial failure) — subscribe async
      subscribeInitialChannels().catch((err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[meshimize-ws] Failed to subscribe initial channels on reconnect: ${errMsg}`,
        );
      });
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
      // Enable onStateChange to subscribe when reconnect succeeds.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[meshimize-ws] Initial connection failed: ${msg}`);
      subscriptionTriggered = true;
      return;
    }

    subscriptionTriggered = true;
    await subscribeInitialChannels();
  }

  async function subscribeInitialChannels(): Promise<void> {
    if (!socket || socket.getState() !== "connected") return;
    const runtimeIdentity = deps.runtimeIdentity ?? api.runtimeIdentity;
    if (!runtimeIdentity) {
      console.error("[meshimize-ws] Cannot subscribe initial channels without runtime identity.");
      return;
    }

    try {
      const identityId = runtimeIdentity.current_identity.id;

      // Clean up any existing identity channel before re-subscribing (Issue A: handler accumulation)
      if (_identityChannel) {
        if (accountDmHandler) {
          _identityChannel.off("new_direct_message", accountDmHandler);
          accountDmHandler = null;
        }
        if (accountDelegationCreatedHandler) {
          _identityChannel.off("delegation_created", accountDelegationCreatedHandler);
          accountDelegationCreatedHandler = null;
        }
        if (accountDelegationUpdatedHandler) {
          _identityChannel.off("delegation_updated", accountDelegationUpdatedHandler);
          accountDelegationUpdatedHandler = null;
        }
        await _identityChannel.leave();
        socket.removeChannel(`identity:${identityId}`);
        _identityChannel = null;
      }

      // Subscribe to identity channel for DMs and delegation events
      const acctCh = socket.channel(`identity:${identityId}`);
      try {
        await acctCh.join();
        _identityChannel = acctCh;

        // Store handler references for cleanup on reconnect (Issue A)
        // Listen for direct messages (Fix 5: stronger runtime validation)
        accountDmHandler = (payload: unknown) => {
          const msg = payload as Record<string, unknown>;
          if (msg && typeof msg === "object" && typeof msg.id === "string") {
            messageBuffer.addDirectMessage(payload as DirectMessageDataResponse);
          }
        };
        acctCh.on("new_direct_message", accountDmHandler);

        // Listen for delegation events
        accountDelegationCreatedHandler = (payload: unknown) => {
          handleDelegationEvent(payload);
        };
        acctCh.on("delegation_created", accountDelegationCreatedHandler);
        accountDelegationUpdatedHandler = (payload: unknown) => {
          handleDelegationEvent(payload);
        };
        acctCh.on("delegation_updated", accountDelegationUpdatedHandler);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[meshimize-ws] Failed to join identity channel: ${msg}`);
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

    // Issue B: Check existing channel state — only skip if genuinely joined
    const existingCh = groupChannels.get(groupId);
    if (existingCh) {
      if (existingCh.getState() === "joined") return;

      // Channel exists but is stale (closed/errored/leaving) — clean up before re-subscribing
      const handler = groupMessageHandlers.get(groupId);
      if (handler) {
        existingCh.off("new_message", handler);
        groupMessageHandlers.delete(groupId);
      }
      groupChannels.delete(groupId);
      socket.removeChannel(`group:${groupId}`);
    }

    const ch = socket.channel(`group:${groupId}`);
    try {
      await ch.join();
      groupChannels.set(groupId, ch);

      // Store handler reference for cleanup (Fix 4 + Fix 6: stronger runtime validation)
      const messageHandler = (payload: unknown) => {
        const msg = payload as Record<string, unknown>;
        if (
          msg &&
          typeof msg === "object" &&
          typeof msg.id === "string" &&
          "group_id" in msg &&
          msg.group_id === groupId
        ) {
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

  function stop(_ctx?: OpenClawPluginServiceContext): void {
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
    _identityChannel = null;
    accountDmHandler = null;
    accountDelegationCreatedHandler = null;
    accountDelegationUpdatedHandler = null;
  }

  return {
    id: "meshimize-ws",
    start,
    stop,
    subscribeToGroup,
    unsubscribeFromGroup,
    getSocket: () => socket,
  };
}
