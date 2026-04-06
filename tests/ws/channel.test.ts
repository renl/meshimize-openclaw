import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PhoenixReplyPayload } from "../../src/types/channels.js";
import { Channel } from "../../src/ws/channel.js";
import type { SocketAdapter } from "../../src/ws/channel.js";

/** Creates a mock SocketAdapter for testing. */
function createMockSocketAdapter() {
  let refCounter = 0;
  const joinReplyOverrides: Map<string, PhoenixReplyPayload> = new Map();
  const leaveReplyOverrides: Map<string, PhoenixReplyPayload> = new Map();
  let joinDelay = 0;
  let leaveDelay = 0;

  const adapter: SocketAdapter & {
    _setJoinReply: (ref: string, reply: PhoenixReplyPayload) => void;
    _setLeaveReply: (ref: string, reply: PhoenixReplyPayload) => void;
    _setDefaultJoinReply: (reply: PhoenixReplyPayload) => void;
    _setDefaultLeaveReply: (reply: PhoenixReplyPayload) => void;
    _setJoinDelay: (ms: number) => void;
    _setLeaveDelay: (ms: number) => void;
    _defaultJoinReply: PhoenixReplyPayload;
    _defaultLeaveReply: PhoenixReplyPayload;
  } = {
    _defaultJoinReply: { status: "ok", response: {} },
    _defaultLeaveReply: { status: "ok", response: {} },
    _setJoinReply: (ref: string, reply: PhoenixReplyPayload) => joinReplyOverrides.set(ref, reply),
    _setLeaveReply: (ref: string, reply: PhoenixReplyPayload) =>
      leaveReplyOverrides.set(ref, reply),
    _setDefaultJoinReply: (reply: PhoenixReplyPayload) => {
      adapter._defaultJoinReply = reply;
    },
    _setDefaultLeaveReply: (reply: PhoenixReplyPayload) => {
      adapter._defaultLeaveReply = reply;
    },
    _setJoinDelay: (ms: number) => {
      joinDelay = ms;
    },
    _setLeaveDelay: (ms: number) => {
      leaveDelay = ms;
    },
    makeRef: () => (++refCounter).toString(),
    sendJoin: async (_joinRef: string, ref: string, _topic: string) => {
      if (joinDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, joinDelay));
      }
      const override = joinReplyOverrides.get(ref);
      return override ?? adapter._defaultJoinReply;
    },
    sendLeave: async (_joinRef: string | null, ref: string, _topic: string) => {
      if (leaveDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, leaveDelay));
      }
      const override = leaveReplyOverrides.get(ref);
      return override ?? adapter._defaultLeaveReply;
    },
  };

  return adapter;
}

describe("Channel", () => {
  let adapter: ReturnType<typeof createMockSocketAdapter>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    adapter = createMockSocketAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("join", () => {
    it("transitions to joining then joined on ok reply", async () => {
      const ch = new Channel("group:test", adapter);

      expect(ch.getState()).toBe("closed");

      const result = await ch.join();

      expect(ch.getState()).toBe("joined");
      expect(result).toEqual({});
    });

    it("rejects if already joining", async () => {
      // Use a delay to keep the channel in "joining" state
      adapter._setJoinDelay(100);

      const ch = new Channel("group:test", adapter);
      const joinPromise = ch.join();

      await expect(ch.join()).rejects.toThrow("already joining");

      // Resolve the first join
      vi.advanceTimersByTime(200);
      await joinPromise;
    });

    it("rejects if already joined", async () => {
      const ch = new Channel("group:test", adapter);
      await ch.join();

      await expect(ch.join()).rejects.toThrow("already joined");
    });

    it("transitions to errored on error reply", async () => {
      adapter._setDefaultJoinReply({
        status: "error",
        response: { reason: "not_a_member" },
      });

      const ch = new Channel("group:test", adapter);

      await expect(ch.join()).rejects.toThrow("Channel join failed");
      expect(ch.getState()).toBe("errored");
    });

    it("sets joinRef and topic correctly", async () => {
      const ch = new Channel("group:my-topic", adapter);
      await ch.join();

      expect(ch.getTopic()).toBe("group:my-topic");
      expect(ch.getJoinRef()).toBe("1"); // first ref generated
    });
  });

  describe("leave", () => {
    it("sends phx_leave and transitions to closed", async () => {
      const ch = new Channel("group:test", adapter);
      await ch.join();

      expect(ch.getState()).toBe("joined");

      await ch.leave();

      expect(ch.getState()).toBe("closed");
      expect(ch.getJoinRef()).toBeNull();
    });

    it("is a no-op if already closed", async () => {
      const ch = new Channel("group:test", adapter);
      expect(ch.getState()).toBe("closed");

      // Should not throw
      await ch.leave();
      expect(ch.getState()).toBe("closed");
    });

    it("is a no-op if already leaving", async () => {
      adapter._setLeaveDelay(100);

      const ch = new Channel("group:test", adapter);
      await ch.join();

      const leavePromise1 = ch.leave();

      // Second leave should no-op (state is "leaving")
      await ch.leave();

      vi.advanceTimersByTime(200);
      await leavePromise1;

      expect(ch.getState()).toBe("closed");
    });

    it("resolves even when sendLeave throws", async () => {
      const errorAdapter: SocketAdapter = {
        makeRef: () => "1",
        sendJoin: async () => ({ status: "ok", response: {} }),
        sendLeave: async () => {
          throw new Error("Network error");
        },
      };

      const ch = new Channel("group:test", errorAdapter);
      await ch.join();

      // leave() should not throw — finally block sets state to closed
      await ch.leave();
      expect(ch.getState()).toBe("closed");
    });
  });

  describe("event handlers", () => {
    it("on/off registration — trigger dispatches to registered handlers", async () => {
      const ch = new Channel("group:test", adapter);
      await ch.join();

      const received: unknown[] = [];
      const handler = (payload: unknown) => received.push(payload);

      ch.on("new_message", handler);

      ch.trigger("new_message", { id: "1", content: "hello" });
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ id: "1", content: "hello" });

      ch.trigger("new_message", { id: "2", content: "world" });
      expect(received).toHaveLength(2);
    });

    it("removing a handler stops delivery", async () => {
      const ch = new Channel("group:test", adapter);
      await ch.join();

      const received: unknown[] = [];
      const handler = (payload: unknown) => received.push(payload);

      ch.on("new_message", handler);
      ch.trigger("new_message", { id: "1" });
      expect(received).toHaveLength(1);

      ch.off("new_message", handler);
      ch.trigger("new_message", { id: "2" });
      expect(received).toHaveLength(1); // no additional delivery
    });

    it("multiple handlers for the same event all receive payloads", async () => {
      const ch = new Channel("group:test", adapter);

      const received1: unknown[] = [];
      const received2: unknown[] = [];

      ch.on("event", (p) => received1.push(p));
      ch.on("event", (p) => received2.push(p));

      ch.trigger("event", { data: 42 });

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it("off is a no-op for unregistered events", () => {
      const ch = new Channel("group:test", adapter);
      const handler = () => {};

      // Should not throw
      ch.off("nonexistent", handler);
    });

    it("off is a no-op for unregistered handlers on existing events", () => {
      const ch = new Channel("group:test", adapter);
      const handler1 = () => {};
      const handler2 = () => {};

      ch.on("event", handler1);
      // Removing a handler that was never registered for this event
      ch.off("event", handler2);

      // handler1 should still work
      const received: unknown[] = [];
      ch.on("event", (p) => received.push(p));
      ch.trigger("event", { test: true });
      expect(received).toHaveLength(1);
    });
  });

  describe("trigger lifecycle events", () => {
    it("phx_error transitions state to errored", async () => {
      const ch = new Channel("group:test", adapter);
      await ch.join();

      expect(ch.getState()).toBe("joined");

      ch.trigger("phx_error", {});

      expect(ch.getState()).toBe("errored");
      expect(ch.getJoinRef()).toBeNull();
    });

    it("phx_close transitions state to closed", async () => {
      const ch = new Channel("group:test", adapter);
      await ch.join();

      expect(ch.getState()).toBe("joined");

      ch.trigger("phx_close", {});

      expect(ch.getState()).toBe("closed");
      expect(ch.getJoinRef()).toBeNull();
    });

    it("handlers see updated state on lifecycle events", async () => {
      const ch = new Channel("group:test", adapter);
      await ch.join();

      let stateSeenByHandler: string | null = null;
      ch.on("phx_error", () => {
        stateSeenByHandler = ch.getState();
      });

      ch.trigger("phx_error", {});
      expect(stateSeenByHandler).toBe("errored");
    });
  });

  describe("resetState", () => {
    it("resets to closed without sending phx_leave", async () => {
      const ch = new Channel("group:test", adapter);
      await ch.join();

      expect(ch.getState()).toBe("joined");
      expect(ch.getJoinRef()).not.toBeNull();

      ch.resetState();

      expect(ch.getState()).toBe("closed");
      expect(ch.getJoinRef()).toBeNull();
    });
  });

  describe("rejoin", () => {
    it("resets state and re-joins the channel", async () => {
      const ch = new Channel("group:test", adapter);
      await ch.join();

      const firstJoinRef = ch.getJoinRef();
      expect(ch.getState()).toBe("joined");

      const result = await ch.rejoin();

      expect(ch.getState()).toBe("joined");
      expect(result).toEqual({});
      // The joinRef should have changed (new join cycle)
      expect(ch.getJoinRef()).not.toBe(firstJoinRef);
    });

    it("works from errored state", async () => {
      const ch = new Channel("group:test", adapter);
      await ch.join();

      ch.trigger("phx_error", {});
      expect(ch.getState()).toBe("errored");

      await ch.rejoin();
      expect(ch.getState()).toBe("joined");
    });
  });

  describe("getters", () => {
    it("getState returns current state", () => {
      const ch = new Channel("group:test", adapter);
      expect(ch.getState()).toBe("closed");
    });

    it("getTopic returns the topic", () => {
      const ch = new Channel("group:my-topic", adapter);
      expect(ch.getTopic()).toBe("group:my-topic");
    });

    it("getJoinRef returns null before join", () => {
      const ch = new Channel("group:test", adapter);
      expect(ch.getJoinRef()).toBeNull();
    });
  });
});
