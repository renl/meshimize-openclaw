// US-PGI-8 / OpenClaw architecture §4.4.1. Real Channel + service, fake socket.
// This is NOT an installed OpenClaw runtime or physical WS proof.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const wire = vi.hoisted(() => ({
  connected: false,
  mode: "ok" as "ok" | "refuse" | "delay",
  release: (() => {}) as () => void,
  channels: new Map<string, import("../../src/ws/channel.js").Channel>(),
  joins: 0,
  groupJoins: 0,
}));
vi.mock("../../src/ws/client.js", async () => {
  const { Channel } = await import("../../src/ws/channel.js");
  return {
    PhoenixSocket: class {
      onStateChange?: (state: string) => void;
      async connect() {
        wire.connected = true;
      }
      disconnect() {
        wire.connected = false;
        for (const ch of wire.channels.values()) ch.resetState();
      }
      getState() {
        return wire.connected ? "connected" : "disconnected";
      }
      channel(topic: string) {
        if (!wire.channels.has(topic)) {
          wire.channels.set(
            topic,
            new Channel(topic, {
              makeRef: () => String(++wire.joins),
              sendJoin: async () => {
                if (topic.startsWith("group:")) {
                  wire.groupJoins++;
                  if (wire.mode === "delay")
                    await new Promise<void>((resolve) => {
                      wire.release = resolve;
                    });
                  if (wire.mode === "refuse")
                    return { status: "error", response: { reason: "not_a_member" } };
                }
                return { status: "ok", response: {} };
              },
              sendLeave: async () => ({ status: "ok", response: {} }),
            }),
          );
        }
        return wire.channels.get(topic)!;
      }
      removeChannel(topic: string) {
        wire.channels.delete(topic);
      }
    },
  };
});
import { createWsService } from "../../src/services/ws-manager.js";
import { MessageBuffer } from "../../src/buffer/message-buffer.js";
import { DelegationContentBuffer } from "../../src/buffer/delegation-content-buffer.js";
import { createPendingJoinMap } from "../../src/state/pending-joins.js";
import { approveJoinHandler, type GroupToolDeps } from "../../src/tools/groups.js";
import { askQuestionHandler } from "../../src/tools/messages.js";

const id = "10000000-0000-4000-8000-000000000001";
describe("accepted membership is distinct from current delivery readiness", () => {
  let service: ReturnType<typeof createWsService>;
  let pending: ReturnType<typeof createPendingJoinMap>;
  let buffer: MessageBuffer;
  let deps: GroupToolDeps;
  beforeEach(() => {
    vi.useFakeTimers();
    wire.connected = false;
    wire.channels.clear();
    wire.mode = "ok";
    wire.joins = 0;
    wire.groupJoins = 0;
    wire.release = () => {};
    buffer = new MessageBuffer();
    const api = {
      joinGroup: vi.fn().mockResolvedValue({
        data: {
          group_id: id,
          agent_identity_id: "20000000-0000-4000-8000-000000000002",
          role: "member",
          inserted_at: "2026-10-18T00:00:00Z",
          created_at: "2026-10-18T00:00:00Z",
        },
      }),
      postMessage: vi
        .fn()
        .mockResolvedValue({ data: { id: "40000000-0000-4000-8000-000000000004" } }),
      getMyGroups: vi
        .fn()
        .mockResolvedValue({ data: [], meta: { has_more: false, next_cursor: null } }),
    };
    service = createWsService({
      api,
      messageBuffer: buffer,
      delegationContentBuffer: new DelegationContentBuffer(),
      config: {
        apiKey: "mshz_fixture",
        baseUrl: "http://example.invalid",
        wsUrl: "ws://example.invalid/api/v1/ws/websocket",
      },
      runtimeIdentity: {
        account: {
          id: "30000000-0000-4000-8000-000000000003",
          display_name: "Owner",
          verified: false,
        },
        current_identity: {
          id: "20000000-0000-4000-8000-000000000002",
          display_name: "Acting sibling",
        },
      },
    } as Parameters<typeof createWsService>[0]);
    pending = createPendingJoinMap({ joinTimeoutMs: 600000, maxPendingJoins: 2 });
    pending.add({
      id,
      name: "Public fixture",
      description: null,
      type: "qa",
      owner: { id: "account", display_name: "Owner", verified: false },
    });
    deps = { api, wsService: service, pendingJoins: pending } as unknown as GroupToolDeps;
  });
  afterEach(async () => {
    wire.release();
    await vi.advanceTimersByTimeAsync(0);
    service.stop?.();
    pending.dispose();
    vi.useRealTimers();
  });
  async function approved() {
    // Always capture rejection immediately; no unhandled promise while timers advance.
    const result = approveJoinHandler({ group_id: id }, deps).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(10001);
    return Promise.race([result, Promise.resolve({ deadline: true })]);
  }
  it.each(["disconnected", "refuse", "silence"])(
    "accepted join + %s is joined-not-ready, not rollback",
    async (mode) => {
      if (mode !== "disconnected") await service.start?.();
      wire.mode = mode === "refuse" ? "refuse" : "delay";
      const result = await approved();
      expect(result).toMatchObject({
        value: {
          group_id: id,
          joined: true,
          role: "member",
          membership_path_ready: null,
          receiver: { ready: false },
        },
      });
      expect(JSON.stringify(result)).toContain("meshimize_list_my_groups");
      expect(pending.getByGroupId(id)).toBeUndefined();
      expect(deps.api.joinGroup).toHaveBeenCalledTimes(1);
      wire.release();
    },
  );
  it("does not announce ready before successful acknowledgement; shared buffer receives the event", async () => {
    await service.start?.();
    wire.mode = "delay";
    let finished = false;
    const result = approveJoinHandler({ group_id: id }, deps).then((value) => {
      finished = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(5);
    expect(finished).toBe(false);
    const channel = wire.channels.get(`group:${id}`)!;
    expect(channel.getState()).toBe("joining");
    wire.release();
    expect(await result).toMatchObject({
      joined: true,
      membership_path_ready: "post_approval_first_ask",
    });
    expect(channel.getState()).toBe("joined");
    channel.trigger("new_message", {
      id: "answer",
      group_id: id,
      content: "Private answer",
      message_type: "answer",
      parent_message_id: "40000000-0000-4000-8000-000000000004",
      sender: {
        id: "50000000-0000-4000-8000-000000000005",
        display_name: "Responder",
        verified: false,
      },
      created_at: "2026-10-18T00:00:01Z",
    });
    expect(JSON.stringify(buffer.getGroupMessages(id))).toContain("Private answer");
  });
  it("disconnect during an outstanding acknowledgement cannot authorize readiness", async () => {
    await service.start?.();
    wire.mode = "delay";
    const result = approveJoinHandler({ group_id: id }, deps);
    await vi.advanceTimersByTimeAsync(5);
    service.getSocket()?.disconnect();
    wire.release();
    expect(await result).toMatchObject({
      joined: true,
      membership_path_ready: null,
      receiver: { ready: false },
    });
  });
  it("concurrent subscription/recovery shares one join and one buffer handler", async () => {
    await service.start?.();
    wire.mode = "delay";
    let secondFinished = false;
    const first = service.subscribeToGroup(id);
    const second = service.subscribeToGroup(id).finally(() => {
      secondFinished = true;
    });
    await vi.advanceTimersByTimeAsync(5);
    const count = wire.groupJoins;
    const early = secondFinished;
    wire.release();
    await Promise.all([first, second]);
    expect(count).toBe(1);
    expect(early).toBe(false);
    const add = vi.spyOn(buffer, "addGroupMessage");
    wire.channels.get(`group:${id}`)!.trigger("new_message", {
      id: "60000000-0000-4000-8000-000000000006",
      group_id: id,
      message_type: "answer",
      content: "Shared answer",
      parent_message_id: "40000000-0000-4000-8000-000000000004",
      sender: {
        id: "50000000-0000-4000-8000-000000000005",
        display_name: "Responder",
        verified: false,
      },
      created_at: "2026-10-18T00:00:01Z",
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(deps.api.joinGroup).not.toHaveBeenCalled();
  });
  it("disconnect before first ask returns delivery-not-ready without posting or rejoining", async () => {
    await service.start?.();
    await service.subscribeToGroup(id);
    service.getSocket()?.disconnect();
    vi.mocked(deps.api.getMyGroups).mockResolvedValue({
      data: [
        {
          id,
          name: "Authorized QA",
          description: null,
          type: "qa",
          visibility: "private",
          owner: {
            id: "30000000-0000-4000-8000-000000000003",
            display_name: "Owner",
            verified: false,
          },
          member_count: 2,
          my_role: "member",
        },
      ],
      meta: { has_more: false, next_cursor: null },
    });
    const outcome = askQuestionHandler(
      { group_id: id, question: "Do not post without receiver", timeout_seconds: 1 },
      { api: deps.api, messageBuffer: buffer, wsService: service } as Parameters<
        typeof askQuestionHandler
      >[1],
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(10001);
    expect(await outcome).toHaveProperty("error");
    expect(deps.api.postMessage).not.toHaveBeenCalled();
    expect(deps.api.joinGroup).not.toHaveBeenCalled();
  });
  it("timed-out reply cannot complete a newer recovery or attach a second handler", async () => {
    await service.start?.();
    wire.mode = "delay";
    const attempt = approveJoinHandler({ group_id: id }, deps).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(5);
    const obsoleteReply = wire.release;
    await vi.advanceTimersByTimeAsync(10001);
    const outcome = await Promise.race([attempt, Promise.resolve({ deadline: true })]);
    expect(outcome).toMatchObject({
      value: { joined: true, membership_path_ready: null, receiver: { ready: false } },
    });
    let recovered = false;
    const recovery = service.subscribeToGroup(id).then(() => {
      recovered = true;
    });
    await vi.advanceTimersByTimeAsync(5);
    const currentReply = wire.release;
    obsoleteReply();
    await vi.advanceTimersByTimeAsync(5);
    expect(recovered).toBe(false);
    expect(wire.channels.get(`group:${id}`)?.getState()).toBe("joining");
    currentReply();
    await recovery;
    const add = vi.spyOn(buffer, "addGroupMessage");
    wire.channels.get(`group:${id}`)!.trigger("new_message", {
      id: "60000000-0000-4000-8000-000000000006",
      group_id: id,
      message_type: "answer",
      content: "Recovered answer",
      parent_message_id: "40000000-0000-4000-8000-000000000004",
      sender: {
        id: "50000000-0000-4000-8000-000000000005",
        display_name: "Responder",
        verified: false,
      },
      created_at: "2026-10-18T00:00:01Z",
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(deps.api.joinGroup).toHaveBeenCalledTimes(1);
  });
});
