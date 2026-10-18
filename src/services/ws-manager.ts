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
 * Truthful delivery readiness for one group. `ready` is only reported after the
 * server acknowledged the group channel on the live socket and the shared-buffer
 * handler is attached; every later disconnect, phx_error or phx_close invalidates it.
 */
export interface ReceiverReadiness {
  ready: boolean;
  reason?: string;
}

/** Readiness probe plus the bounded wait window a caller may rely on. */
export interface ReceiverGate {
  isReceiverReady: (groupId: string) => boolean;
  awaitReceiverReady: (groupId: string, timeoutMs: number) => Promise<ReceiverReadiness>;
}

/**
 * Extended service type that exposes internal methods for tool implementations.
 * Tools (Slice 4+) call subscribeToGroup/unsubscribeFromGroup when the agent joins/leaves groups.
 */
export interface WsService extends OpenClawPluginService, ReceiverGate {
  subscribeToGroup: (groupId: string) => Promise<void>;
  unsubscribeFromGroup: (groupId: string) => Promise<void>;
  getSocket: () => PhoenixSocket | null;
}

/** One bounded attempt to own a group's delivered messages on one socket. */
interface GroupReceiver {
  groupId: string;
  socket: PhoenixSocket;
  channel: Channel;
  handler: ((payload: unknown) => void) | null;
  lifecycle: ((payload: unknown) => void) | null;
  ready: boolean;
  done: boolean;
  settled: Promise<void>;
  settle: () => void;
}

export function createWsService(deps: WsManagerDeps): WsService {
  const { config, api, messageBuffer, delegationContentBuffer } = deps;

  let socket: PhoenixSocket | null = null;
  const receivers: Map<string, GroupReceiver> = new Map();
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
      if (state !== "connected") {
        // Any disconnect/reconnect invalidates every delivery claim: a receiver is
        // only truthful for the socket that acked it.
        invalidateReceivers();
        return;
      }

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

  /**
   * Escalates a group to a truthful receiver: resolves only once the current
   * socket has an acknowledged group channel and the shared-buffer handler is
   * attached. It never throws — callers must confirm with `isReceiverReady`
   * instead of assuming that resolution means delivery.
   */
  function subscribeToGroup(groupId: string): Promise<void> {
    const current = socket;
    if (!current || current.getState() !== "connected") return Promise.resolve();

    const existing = receivers.get(groupId);
    if (existing && existing.socket === current) {
      if (isReceiverReady(groupId)) return Promise.resolve();
      // One attempt per connection: coalesce instead of adding a second join.
      if (!existing.done && !existing.ready) return existing.settled;
    }
    if (existing) retire(existing);

    const channel = current.channel(`group:${groupId}`);
    let settle = (): void => {};
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const receiver: GroupReceiver = {
      groupId,
      socket: current,
      channel,
      handler: null,
      lifecycle: null,
      ready: false,
      done: false,
      settled,
      settle,
    };
    receivers.set(groupId, receiver);
    watch(receiver);
    void receive(receiver);
    return settled;
  }

  /** Waits for the current receiver to be ready; resolves with the truth either way. */
  async function awaitReceiverReady(
    groupId: string,
    timeoutMs: number,
  ): Promise<ReceiverReadiness> {
    if (isReceiverReady(groupId)) return { ready: true };

    const pending = subscribeToGroup(groupId);
    const raced = receivers.get(groupId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<ReceiverReadiness>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            ready: false,
            reason: `no acknowledged group receiver within ${timeoutMs}ms of the accepted join`,
          }),
        timeoutMs,
      );
    });

    try {
      return await Promise.race([
        pending.then<ReceiverReadiness>(() =>
          isReceiverReady(groupId)
            ? { ready: true }
            : { ready: false, reason: describeUnready(groupId) },
        ),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
      // A timed-out attempt must not swallow a later explicit recovery attempt.
      if (raced && !raced.ready && receivers.get(groupId) === raced) retire(raced);
    }
  }

  /** True only for an acknowledged group channel with a handler on the live socket. */
  function isReceiverReady(groupId: string): boolean {
    const current = socket;
    const receiver = receivers.get(groupId);
    return (
      current !== null &&
      receiver !== undefined &&
      receiver.socket === current &&
      receiver.ready &&
      receiver.handler !== null &&
      current.getState() === "connected" &&
      receiver.channel.getState() === "joined"
    );
  }

  function describeUnready(groupId: string): string {
    const current = socket;
    if (!current) return "the WebSocket service is stopped";
    if (current.getState() !== "connected") return `the WebSocket is ${current.getState()}`;
    const receiver = receivers.get(groupId);
    if (!receiver) return "no group receiver attempt is current for this connection";
    if (receiver.channel.getState() === "errored")
      return "the server rejected the group channel join";
    return `the group channel is ${receiver.channel.getState()} without an attached answer handler`;
  }

  /** Watches server-initiated channel lifecycle events; either one invalidates delivery. */
  function watch(receiver: GroupReceiver): void {
    const lifecycle = (): void => {
      retire(receiver);
    };
    receiver.lifecycle = lifecycle;
    receiver.channel.on("phx_error", lifecycle);
    receiver.channel.on("phx_close", lifecycle);
  }

  /** Attaches the shared-buffer handler. Only ever called after an acknowledgement. */
  function attach(receiver: GroupReceiver): void {
    const groupId = receiver.groupId;
    const handler = (payload: unknown) => {
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
    receiver.handler = handler;
    receiver.channel.on("new_message", handler);
  }

  async function receive(receiver: GroupReceiver): Promise<void> {
    const { channel } = receiver;
    const current = receiver.socket;
    try {
      if (channel.getState() === "joining") {
        // Coalesce with a join already in flight instead of adding a duplicate one.
        await channel.pendingJoin();
      } else if (channel.getState() !== "joined") {
        await channel.join();
      }
      if (
        receiver.done ||
        socket !== current ||
        current.getState() !== "connected" ||
        channel.getState() !== "joined"
      ) {
        throw new Error("group channel is not acknowledged on the current connection");
      }
      attach(receiver);
      receiver.ready = true;
    } catch {
      // Not ready: callers report the truth instead of assuming delivery.
    } finally {
      receiver.done = true;
      if (!receiver.ready) retire(receiver);
      receiver.settle();
    }
  }

  /** Drops a receiver's claims (handlers, readiness) without touching the socket. */
  function detach(receiver: GroupReceiver): void {
    receiver.done = true;
    receiver.ready = false;
    if (receiver.handler) {
      receiver.channel.off("new_message", receiver.handler);
      receiver.handler = null;
    }
    if (receiver.lifecycle) {
      receiver.channel.off("phx_error", receiver.lifecycle);
      receiver.channel.off("phx_close", receiver.lifecycle);
      receiver.lifecycle = null;
    }
  }

  /** Drops a receiver claim and its channel, so a later attempt starts a fresh join. */
  function retire(receiver: GroupReceiver): void {
    detach(receiver);
    receiver.channel.resetState();
    // Only the current attempt owns the socket's channel for this topic; a stale
    // attempt must never remove a newer attempt's channel.
    if (receivers.get(receiver.groupId) === receiver) {
      receivers.delete(receiver.groupId);
      receiver.socket.removeChannel(`group:${receiver.groupId}`);
    }
    receiver.settle();
  }

  function invalidateReceivers(): void {
    for (const receiver of Array.from(receivers.values())) retire(receiver);
  }

  async function unsubscribeFromGroup(groupId: string): Promise<void> {
    const receiver = receivers.get(groupId);
    if (!receiver) return;

    detach(receiver);
    // Leave before dropping channel state so the server learns about the intent.
    await receiver.channel.leave();
    retire(receiver);
    messageBuffer.clearGroup(groupId);
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

    invalidateReceivers();

    if (socket) {
      socket.disconnect();
      socket = null;
    }
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
    isReceiverReady,
    awaitReceiverReady,
    getSocket: () => socket,
  };
}
