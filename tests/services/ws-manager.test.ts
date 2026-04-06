import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mocks ---

// Track mock channels for assertions
interface MockChannel {
  topic: string;
  joinCalled: boolean;
  leaveCalled: boolean;
  handlers: Map<string, Array<(payload: unknown) => void>>;
  join: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  on: (event: string, handler: (payload: unknown) => void) => void;
  off: (event: string, handler: (payload: unknown) => void) => void;
  getState: () => string;
  getTopic: () => string;
  getJoinRef: () => string | null;
  resetState: () => void;
  trigger: (event: string, payload: unknown) => void;
  rejoin: ReturnType<typeof vi.fn>;
}

let mockChannels: Map<string, MockChannel>;
let mockSocketConnected: boolean;
let mockConnectFn: ReturnType<typeof vi.fn>;
let mockDisconnectFn: ReturnType<typeof vi.fn>;

function createMockChannel(topic: string): MockChannel {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  const ch: MockChannel = {
    topic,
    joinCalled: false,
    leaveCalled: false,
    handlers,
    join: vi.fn().mockImplementation(async () => {
      ch.joinCalled = true;
      return {};
    }),
    leave: vi.fn().mockImplementation(async () => {
      ch.leaveCalled = true;
    }),
    on: (event: string, handler: (payload: unknown) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    off: (event: string, handler: (payload: unknown) => void) => {
      const list = handlers.get(event);
      if (!list) return;
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    },
    getState: () => (ch.joinCalled ? "joined" : "closed"),
    getTopic: () => topic,
    getJoinRef: () => (ch.joinCalled ? "1" : null),
    resetState: () => {
      ch.joinCalled = false;
    },
    trigger: (event: string, payload: unknown) => {
      const list = handlers.get(event);
      if (list) {
        for (const h of list.slice()) h(payload);
      }
    },
    rejoin: vi.fn().mockImplementation(async () => {
      ch.joinCalled = true;
      return {};
    }),
  };
  return ch;
}

vi.mock("../../src/ws/client.js", () => {
  return {
    PhoenixSocket: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockImplementation(async () => {
        if (mockConnectFn) return mockConnectFn();
        mockSocketConnected = true;
      }),
      disconnect: vi.fn().mockImplementation(() => {
        if (mockDisconnectFn) mockDisconnectFn();
        mockSocketConnected = false;
      }),
      getState: vi
        .fn()
        .mockImplementation(() => (mockSocketConnected ? "connected" : "disconnected")),
      channel: vi.fn().mockImplementation((topic: string) => {
        let ch = mockChannels.get(topic);
        if (!ch) {
          ch = createMockChannel(topic);
          mockChannels.set(topic, ch);
        }
        return ch;
      }),
      makeRef: vi.fn().mockReturnValue("1"),
    })),
  };
});

import { createWsService } from "../../src/services/ws-manager.js";
import type { WsManagerDeps } from "../../src/services/ws-manager.js";
import { MessageBuffer } from "../../src/buffer/message-buffer.js";
import { DelegationContentBuffer } from "../../src/buffer/delegation-content-buffer.js";
import type { Config } from "../../src/config.js";

// Mock the MeshimizeAPI
function createMockApi() {
  return {
    getAccount: vi.fn().mockResolvedValue({
      data: {
        id: "acct-001",
        email: "test@example.com",
        display_name: "Test Agent",
        description: null,
        allow_direct_connections: true,
        verified: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    }),
    getMyGroups: vi.fn().mockResolvedValue({
      data: [
        {
          id: "group-001",
          name: "Test Group 1",
          description: "A test group",
          type: "qa",
          visibility: "public",
          my_role: "member",
          owner: { id: "owner-1", display_name: "Owner", verified: true },
          member_count: 5,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "group-002",
          name: "Test Group 2",
          description: null,
          type: "open_discussion",
          visibility: "public",
          my_role: "member",
          owner: { id: "owner-2", display_name: "Owner2", verified: true },
          member_count: 3,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      meta: { has_more: false, next_cursor: null, count: 2 },
    }),
  } as unknown as WsManagerDeps["api"];
}

describe("WsManager — createWsService", () => {
  let config: Config;
  let mockApi: ReturnType<typeof createMockApi>;
  let messageBuffer: MessageBuffer;
  let delegationContentBuffer: DelegationContentBuffer;

  beforeEach(() => {
    mockChannels = new Map();
    mockSocketConnected = false;
    mockConnectFn = vi.fn().mockImplementation(async () => {
      mockSocketConnected = true;
    });
    mockDisconnectFn = vi.fn();

    config = {
      apiKey: "mshz_test123",
      baseUrl: "https://api.meshimize.com",
      wsUrl: "wss://api.meshimize.com/api/v1/ws/websocket",
    };

    mockApi = createMockApi();
    messageBuffer = new MessageBuffer();
    delegationContentBuffer = new DelegationContentBuffer();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a ServiceDefinition with name, start, and stop", () => {
    const service = createWsService({
      config,
      api: mockApi,
      messageBuffer,
      delegationContentBuffer,
    });

    expect(service.name).toBe("meshimize-ws");
    expect(typeof service.start).toBe("function");
    expect(typeof service.stop).toBe("function");
  });

  it("exposes subscribeToGroup and unsubscribeFromGroup methods", () => {
    const service = createWsService({
      config,
      api: mockApi,
      messageBuffer,
      delegationContentBuffer,
    });

    expect(typeof service.subscribeToGroup).toBe("function");
    expect(typeof service.unsubscribeFromGroup).toBe("function");
  });

  it("exposes getSocket method", () => {
    const service = createWsService({
      config,
      api: mockApi,
      messageBuffer,
      delegationContentBuffer,
    });

    expect(typeof service.getSocket).toBe("function");
    // Before start, socket is null
    expect(service.getSocket()).toBeNull();
  });

  describe("start", () => {
    it("connects WebSocket", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      expect(mockConnectFn).toHaveBeenCalled();
      expect(service.getSocket()).not.toBeNull();
    });

    it("subscribes to account channel", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      expect(mockApi.getAccount).toHaveBeenCalled();
      const acctChannel = mockChannels.get("account:acct-001");
      expect(acctChannel).toBeDefined();
      expect(acctChannel!.joinCalled).toBe(true);
    });

    it("subscribes to group channels", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      expect(mockApi.getMyGroups).toHaveBeenCalledWith({ limit: 100 });

      const groupCh1 = mockChannels.get("group:group-001");
      const groupCh2 = mockChannels.get("group:group-002");
      expect(groupCh1).toBeDefined();
      expect(groupCh1!.joinCalled).toBe(true);
      expect(groupCh2).toBeDefined();
      expect(groupCh2!.joinCalled).toBe(true);
    });

    it("handles initial connection failure gracefully — does not throw", async () => {
      mockConnectFn = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      // Should NOT throw
      await expect(service.start()).resolves.toBeUndefined();

      // API calls should NOT have been made (connection failed)
      expect(mockApi.getAccount).not.toHaveBeenCalled();
    });

    it("handles getAccount failure gracefully — does not throw", async () => {
      (mockApi.getAccount as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API error"));

      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      // Should NOT throw
      await expect(service.start()).resolves.toBeUndefined();
    });
  });

  describe("message routing", () => {
    it("group messages are routed to MessageBuffer", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      // Find the group channel and trigger a new_message event
      const groupCh = mockChannels.get("group:group-001");
      expect(groupCh).toBeDefined();

      const testMessage = {
        id: "msg-001",
        group_id: "group-001",
        content: "Test message content",
        message_type: "post" as const,
        parent_message_id: null,
        sender: { id: "sender-1", display_name: "Sender", verified: true },
        created_at: "2026-01-01T00:00:00Z",
      };

      groupCh!.trigger("new_message", testMessage);

      const messages = messageBuffer.getGroupMessages("group-001");
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe("msg-001");
      expect(messages[0].content).toBe("Test message content");
    });

    it("direct messages are routed to MessageBuffer", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      const acctCh = mockChannels.get("account:acct-001");
      expect(acctCh).toBeDefined();

      const testDM = {
        id: "dm-001",
        content: "Direct message content",
        sender: { id: "sender-2", display_name: "DM Sender", verified: true },
        recipient: { id: "acct-001", display_name: "Test Agent" },
        created_at: "2026-01-01T00:00:00Z",
      };

      acctCh!.trigger("new_direct_message", testDM);

      const dms = messageBuffer.getDirectMessages();
      expect(dms).toHaveLength(1);
      expect(dms[0].id).toBe("dm-001");
      expect(dms[0].content).toBe("Direct message content");
    });

    it("ignores messages without an id field", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      const groupCh = mockChannels.get("group:group-001");
      expect(groupCh).toBeDefined();

      // Trigger with payload missing id
      groupCh!.trigger("new_message", { content: "no id" });

      const messages = messageBuffer.getGroupMessages("group-001");
      expect(messages).toHaveLength(0);
    });
  });

  describe("delegation events", () => {
    it("delegation_created stores description in DelegationContentBuffer", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      const acctCh = mockChannels.get("account:acct-001");
      expect(acctCh).toBeDefined();

      acctCh!.trigger("delegation_created", {
        id: "deleg-001",
        description: "Do a task",
        result: null,
      });

      const content = delegationContentBuffer.get("deleg-001");
      expect(content).toBeDefined();
      expect(content!.description).toBe("Do a task");
    });

    it("delegation_updated stores result in DelegationContentBuffer", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      const acctCh = mockChannels.get("account:acct-001");
      expect(acctCh).toBeDefined();

      acctCh!.trigger("delegation_updated", {
        id: "deleg-002",
        description: "Some task",
        result: "Task completed successfully",
      });

      const content = delegationContentBuffer.get("deleg-002");
      expect(content).toBeDefined();
      expect(content!.description).toBe("Some task");
      expect(content!.result).toBe("Task completed successfully");
    });

    it("ignores delegation events without a string id", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      const acctCh = mockChannels.get("account:acct-001");
      expect(acctCh).toBeDefined();

      acctCh!.trigger("delegation_created", { description: "no id" });
      acctCh!.trigger("delegation_created", null);
      acctCh!.trigger("delegation_created", 42);

      // None should have been stored
      expect(delegationContentBuffer.get("undefined")).toBeUndefined();
    });
  });

  describe("subscribeToGroup", () => {
    it("joins a new group channel after start", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      // Subscribe to a new group not in initial list
      await service.subscribeToGroup("group-new");

      const ch = mockChannels.get("group:group-new");
      expect(ch).toBeDefined();
      expect(ch!.joinCalled).toBe(true);
    });

    it("is a no-op if group is already subscribed", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      // group-001 was subscribed during start
      const chBefore = mockChannels.get("group:group-001");
      const joinCallsBefore = chBefore!.join.mock.calls.length;

      await service.subscribeToGroup("group-001");

      // join should NOT have been called again
      expect(chBefore!.join.mock.calls.length).toBe(joinCallsBefore);
    });

    it("is a no-op when socket is not connected", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      // Don't call start — socket is null
      await service.subscribeToGroup("group-003");

      expect(mockChannels.has("group:group-003")).toBe(false);
    });
  });

  describe("unsubscribeFromGroup", () => {
    it("leaves channel and clears buffer", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      // Add a message to the buffer first
      messageBuffer.addGroupMessage("group-001", {
        id: "msg-001",
        group_id: "group-001",
        content: "Hello",
        message_type: "post",
        parent_message_id: null,
        sender: { id: "s1", display_name: "S", verified: true },
        created_at: "2026-01-01T00:00:00Z",
      });

      expect(messageBuffer.getGroupMessages("group-001")).toHaveLength(1);

      await service.unsubscribeFromGroup("group-001");

      const ch = mockChannels.get("group:group-001");
      expect(ch!.leaveCalled).toBe(true);

      // Buffer should be cleared
      expect(messageBuffer.getGroupMessages("group-001")).toHaveLength(0);
    });

    it("is a no-op for unsubscribed groups", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      // Should not throw
      await service.unsubscribeFromGroup("nonexistent-group");
    });
  });

  describe("stop", () => {
    it("disconnects socket", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();
      expect(service.getSocket()).not.toBeNull();

      service.stop!();

      expect(mockDisconnectFn).toHaveBeenCalled();
      expect(service.getSocket()).toBeNull();
    });

    it("is idempotent — calling stop twice does not throw", async () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      service.stop!();
      // Second call should be a no-op
      expect(() => service.stop!()).not.toThrow();
    });

    it("is safe to call stop without start", () => {
      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      // Should not throw
      expect(() => service.stop!()).not.toThrow();
    });
  });

  describe("process exit handlers", () => {
    it("binds SIGTERM and SIGINT handlers on start", async () => {
      const processOnSpy = vi.spyOn(process, "on");

      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      const sigTermCalls = processOnSpy.mock.calls.filter((c) => c[0] === "SIGTERM");
      const sigIntCalls = processOnSpy.mock.calls.filter((c) => c[0] === "SIGINT");

      expect(sigTermCalls.length).toBeGreaterThanOrEqual(1);
      expect(sigIntCalls.length).toBeGreaterThanOrEqual(1);

      processOnSpy.mockRestore();
    });

    it("does not bind handlers when connection fails at startup", async () => {
      mockConnectFn = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const processOnSpy = vi.spyOn(process, "on");

      const service = createWsService({
        config,
        api: mockApi,
        messageBuffer,
        delegationContentBuffer,
      });

      await service.start();

      const sigTermCalls = processOnSpy.mock.calls.filter((c) => c[0] === "SIGTERM");
      const sigIntCalls = processOnSpy.mock.calls.filter((c) => c[0] === "SIGINT");

      // Handlers should NOT be bound when connection failed
      expect(sigTermCalls.length).toBe(0);
      expect(sigIntCalls.length).toBe(0);

      processOnSpy.mockRestore();
    });
  });
});
