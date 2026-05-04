import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MeshimizeAPI } from "../../src/api/client.js";
import type {
  DirectMessageDataResponse,
  DirectMessageMetadataResponse,
} from "../../src/types/messages.js";
import type { PaginatedResponse } from "../../src/types/api.js";
import { MessageBuffer } from "../../src/buffer/message-buffer.js";
import {
  sendDirectMessageHandler,
  getDirectMessagesHandler,
  registerDirectMessageTools,
} from "../../src/tools/direct-messages.js";
import { createMockPluginAPI } from "../__mocks__/openclaw-plugin-sdk/api.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeDirectMessageDataResponse(
  overrides: Partial<DirectMessageDataResponse> = {},
): DirectMessageDataResponse {
  return {
    id: "dm-1",
    content: "Hello direct",
    sender: { id: "acct-1", display_name: "Sender One", verified: true },
    recipient: { id: "acct-2", display_name: "Recipient Two" },
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDirectMessageMetadataResponse(
  overrides: Partial<DirectMessageMetadataResponse> = {},
): DirectMessageMetadataResponse {
  return {
    id: "dm-1",
    sender: { id: "acct-1", display_name: "Sender One", verified: true },
    recipient: { id: "acct-2", display_name: "Recipient Two" },
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePaginatedResponse<T>(
  data: T[],
  hasMore = false,
  nextCursor: string | null = null,
): PaginatedResponse<T> {
  return {
    data,
    meta: { has_more: hasMore, next_cursor: nextCursor, count: data.length },
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockApi(): {
  [K in keyof MeshimizeAPI]: K extends "invalidKey" | "configBaseUrl" | "runtimeIdentity"
    ? MeshimizeAPI[K]
    : ReturnType<typeof vi.fn>;
} {
  return {
    invalidKey: false,
    configBaseUrl: "https://api.meshimize.com",
    runtimeIdentity: null,
    getAccount: vi.fn(),
    resolveRuntimeIdentity: vi.fn(),
    searchGroups: vi.fn(),
    getMyGroups: vi.fn(),
    joinGroup: vi.fn(),
    leaveGroup: vi.fn(),
    getMessages: vi.fn(),
    postMessage: vi.fn(),
    getDirectMessages: vi.fn(),
    sendDirectMessage: vi.fn(),
    createDelegation: vi.fn(),
    listDelegations: vi.fn(),
    getDelegation: vi.fn(),
    acceptDelegation: vi.fn(),
    completeDelegation: vi.fn(),
    cancelDelegation: vi.fn(),
    acknowledgeDelegation: vi.fn(),
    extendDelegation: vi.fn(),
  };
}

function createDeps() {
  const api = createMockApi();
  const messageBuffer = new MessageBuffer();
  return {
    api: api as unknown as MeshimizeAPI,
    messageBuffer,
    _api: api,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sendDirectMessageHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("sends a direct message and returns the data", async () => {
    const dm = makeDirectMessageDataResponse({ id: "dm-new" });
    deps._api.sendDirectMessage.mockResolvedValue({ data: dm });

    const result = await sendDirectMessageHandler(
      { recipient_identity_id: "identity-2", content: "Hello" },
      deps,
    );

    expect(result.message).toEqual(dm);
    expect(deps._api.sendDirectMessage).toHaveBeenCalledWith({
      recipient_identity_id: "identity-2",
      content: "Hello",
    });
  });

  it("handles REST client error", async () => {
    deps._api.sendDirectMessage.mockRejectedValue(new Error("not found"));
    await expect(
      sendDirectMessageHandler({ recipient_identity_id: "identity-2", content: "Hi" }, deps),
    ).rejects.toThrow("not found");
  });
});

describe("getDirectMessagesHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("returns messages from buffer when available", async () => {
    const dm = makeDirectMessageDataResponse();
    deps.messageBuffer.addDirectMessage(dm);

    const result = await getDirectMessagesHandler({}, deps);

    expect(result.source).toBe("buffer");
    expect(result.messages).toHaveLength(1);
    expect(result.has_more).toBe(false);
    expect(deps._api.getDirectMessages).not.toHaveBeenCalled();
  });

  it("falls back to REST API when buffer is empty", async () => {
    const metadata = makeDirectMessageMetadataResponse();
    deps._api.getDirectMessages.mockResolvedValue(makePaginatedResponse([metadata], true));

    const result = await getDirectMessagesHandler({}, deps);

    expect(result.source).toBe("api");
    expect(result.messages).toHaveLength(1);
    expect(result.has_more).toBe(true);
  });

  it("passes after_message_id and limit to buffer", async () => {
    const dm1 = makeDirectMessageDataResponse({ id: "dm-1" });
    const dm2 = makeDirectMessageDataResponse({ id: "dm-2" });
    deps.messageBuffer.addDirectMessage(dm1);
    deps.messageBuffer.addDirectMessage(dm2);

    const result = await getDirectMessagesHandler({ after_message_id: "dm-1", limit: 1 }, deps);

    expect(result.source).toBe("buffer");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].id).toBe("dm-2");
  });

  it("passes after and limit to REST API when buffer empty", async () => {
    deps._api.getDirectMessages.mockResolvedValue(makePaginatedResponse([]));

    await getDirectMessagesHandler({ after_message_id: "dm-cursor", limit: 25 }, deps);

    expect(deps._api.getDirectMessages).toHaveBeenCalledWith({
      after: "dm-cursor",
      limit: 25,
    });
  });
});

describe("registerDirectMessageTools", () => {
  it("registers all 2 tools with correct names", () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();
    registerDirectMessageTools(pluginApi, deps);

    const toolNames = pluginApi._registeredTools.map((t) => t.name);
    expect(toolNames).toEqual(["meshimize_send_direct_message", "meshimize_get_direct_messages"]);
  });

  it("each tool has a description and parameters", () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();
    registerDirectMessageTools(pluginApi, deps);

    for (const tool of pluginApi._registeredTools) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("each execute wrapper catches errors and returns error result with details", async () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();

    deps._api.sendDirectMessage.mockRejectedValue(new Error("test-error"));
    deps._api.getDirectMessages.mockRejectedValue(new Error("test-error"));

    registerDirectMessageTools(pluginApi, deps);

    // Test send_direct_message error handling
    const sendTool = pluginApi._registeredTools.find(
      (t) => t.name === "meshimize_send_direct_message",
    )!;
    const sendResult = await sendTool.execute("test-id", {
      recipient_identity_id: "identity-2",
      content: "hi",
    });
    expect((sendResult as Record<string, unknown>).details).toEqual({ error: true });
    const sendParsed = JSON.parse(sendResult.content[0].text);
    expect(sendParsed.error).toBe("Meshimize: test-error");

    // Test get_direct_messages error handling
    const getTool = pluginApi._registeredTools.find(
      (t) => t.name === "meshimize_get_direct_messages",
    )!;
    const getResult = await getTool.execute("test-id", {});
    expect((getResult as Record<string, unknown>).details).toEqual({ error: true });
  });

  it("send_direct_message execute returns success result with correct format", async () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();
    const dm = makeDirectMessageDataResponse();
    deps._api.sendDirectMessage.mockResolvedValue({ data: dm });

    registerDirectMessageTools(pluginApi, deps);

    const tool = pluginApi._registeredTools.find(
      (t) => t.name === "meshimize_send_direct_message",
    )!;
    const result = await tool.execute("test-id", {
      recipient_identity_id: "identity-2",
      content: "Hi",
    });

    expect((result as Record<string, unknown>).details).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.message).toBeDefined();
    expect(parsed.message.id).toBe("dm-1");
  });
});
