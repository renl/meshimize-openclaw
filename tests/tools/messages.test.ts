import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MeshimizeAPI } from "../../src/api/client.js";
import type { MessageDataResponse, MessageMetadataResponse } from "../../src/types/messages.js";
import type { GroupResponse } from "../../src/types/groups.js";
import type { PaginatedResponse } from "../../src/types/api.js";
import { MessageBuffer } from "../../src/buffer/message-buffer.js";
import {
  getMessagesHandler,
  postMessageHandler,
  askQuestionHandler,
  getPendingQuestionsHandler,
  registerMessageTools,
} from "../../src/tools/messages.js";
import { createMockPluginAPI } from "../__mocks__/openclaw-plugin-sdk/api.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeMessageDataResponse(
  overrides: Partial<MessageDataResponse> = {},
): MessageDataResponse {
  return {
    id: "msg-1",
    group_id: "g-1",
    content: "Hello world",
    message_type: "post",
    parent_message_id: null,
    sender: { id: "acct-1", display_name: "Sender One", verified: true },
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeMessageMetadataResponse(
  overrides: Partial<MessageMetadataResponse> = {},
): MessageMetadataResponse {
  return {
    id: "msg-1",
    group_id: "g-1",
    message_type: "post",
    parent_message_id: null,
    sender: { id: "acct-1", display_name: "Sender One", verified: true },
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeGroupResponse(overrides: Partial<GroupResponse> = {}): GroupResponse {
  return {
    id: "g-1",
    name: "Test Group",
    description: "A test group",
    type: "qa",
    visibility: "public",
    my_role: "member",
    owner: { id: "owner-1", display_name: "Owner One", verified: true },
    member_count: 5,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
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
    setRuntimeIdentity: vi.fn(),
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

describe("getMessagesHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("returns messages from buffer when available", async () => {
    const msg = makeMessageDataResponse({ group_id: "g-1" });
    deps.messageBuffer.addGroupMessage("g-1", msg);

    const result = await getMessagesHandler({ group_id: "g-1" }, deps);

    expect(result.source).toBe("buffer");
    expect(result.messages).toHaveLength(1);
    expect(result.has_more).toBe(false);
    expect(deps._api.getMessages).not.toHaveBeenCalled();
  });

  it("falls back to REST API when buffer is empty", async () => {
    const metadata = makeMessageMetadataResponse();
    deps._api.getMessages.mockResolvedValue(makePaginatedResponse([metadata], true));

    const result = await getMessagesHandler({ group_id: "g-1" }, deps);

    expect(result.source).toBe("api");
    expect(result.messages).toHaveLength(1);
    expect(result.has_more).toBe(true);
    expect(deps._api.getMessages).toHaveBeenCalledWith("g-1", {
      after: undefined,
      limit: undefined,
    });
  });

  it("passes after_message_id and limit to buffer", async () => {
    const msg1 = makeMessageDataResponse({ id: "msg-1", group_id: "g-1" });
    const msg2 = makeMessageDataResponse({ id: "msg-2", group_id: "g-1" });
    deps.messageBuffer.addGroupMessage("g-1", msg1);
    deps.messageBuffer.addGroupMessage("g-1", msg2);

    const result = await getMessagesHandler(
      { group_id: "g-1", after_message_id: "msg-1", limit: 1 },
      deps,
    );

    expect(result.source).toBe("buffer");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].id).toBe("msg-2");
  });

  it("passes after and limit to REST API when buffer empty", async () => {
    deps._api.getMessages.mockResolvedValue(makePaginatedResponse([]));

    await getMessagesHandler({ group_id: "g-1", after_message_id: "msg-cursor", limit: 25 }, deps);

    expect(deps._api.getMessages).toHaveBeenCalledWith("g-1", {
      after: "msg-cursor",
      limit: 25,
    });
  });
});

describe("postMessageHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("posts a message and returns the data", async () => {
    const msg = makeMessageDataResponse({ id: "msg-new" });
    deps._api.postMessage.mockResolvedValue({ data: msg });

    const result = await postMessageHandler(
      { group_id: "g-1", content: "Hello", message_type: "post" },
      deps,
    );

    expect(result.message).toEqual(msg);
    expect(deps._api.postMessage).toHaveBeenCalledWith("g-1", {
      content: "Hello",
      message_type: "post",
      parent_message_id: null,
    });
  });

  it("passes parent_message_id when provided", async () => {
    const msg = makeMessageDataResponse({ id: "msg-answer", message_type: "answer" });
    deps._api.postMessage.mockResolvedValue({ data: msg });

    await postMessageHandler(
      {
        group_id: "g-1",
        content: "Answer text",
        message_type: "answer",
        parent_message_id: "msg-question",
      },
      deps,
    );

    expect(deps._api.postMessage).toHaveBeenCalledWith("g-1", {
      content: "Answer text",
      message_type: "answer",
      parent_message_id: "msg-question",
    });
  });

  it("handles REST client error", async () => {
    deps._api.postMessage.mockRejectedValue(new Error("forbidden"));
    await expect(
      postMessageHandler({ group_id: "g-1", content: "Hello", message_type: "post" }, deps),
    ).rejects.toThrow("forbidden");
  });
});

describe("askQuestionHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    vi.useFakeTimers();
    deps = createDeps();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws when user is not a member", async () => {
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([]));

    await expect(askQuestionHandler({ group_id: "g-1", question: "What?" }, deps)).rejects.toThrow(
      "You are not currently a member of this group.",
    );
  });

  it("throws when group is not a Q&A group", async () => {
    const group = makeGroupResponse({ id: "g-1", type: "open_discussion" });
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([group]));

    await expect(askQuestionHandler({ group_id: "g-1", question: "What?" }, deps)).rejects.toThrow(
      "`meshimize_ask_question` is only valid for Q&A groups.",
    );
  });

  it("returns answered result when answer arrives in buffer", async () => {
    const qaGroup = makeGroupResponse({ id: "g-1", type: "qa", my_role: "member" });
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([qaGroup]));

    const questionMsg = makeMessageDataResponse({
      id: "q-1",
      group_id: "g-1",
      message_type: "question",
    });
    deps._api.postMessage.mockResolvedValue({ data: questionMsg });

    // Simulate answer arriving after a short delay
    const answerMsg = makeMessageDataResponse({
      id: "a-1",
      group_id: "g-1",
      content: "The answer is 42",
      message_type: "answer",
      parent_message_id: "q-1",
      sender: { id: "responder-1", display_name: "Responder", verified: true },
      created_at: "2026-01-01T00:00:01Z",
    });

    // Add the answer to the buffer after a brief delay
    setTimeout(() => {
      deps.messageBuffer.addGroupMessage("g-1", answerMsg);
    }, 250);

    const resultPromise = askQuestionHandler(
      { group_id: "g-1", question: "What is the answer?", timeout_seconds: 90 },
      deps,
    );

    // Advance past the first poll (500ms) to pick up the answer
    await vi.advanceTimersByTimeAsync(600);

    const result = await resultPromise;

    expect(result.answered).toBe(true);
    expect(result.question_id).toBe("q-1");
    expect(result.answer).toBeDefined();
    expect(result.answer!.id).toBe("a-1");
    expect(result.answer!.content).toBe("The answer is 42");
    expect(result.answer!.responder_identity_id).toBe("responder-1");
    expect(result.answer!.responder_display_name).toBe("Responder");
    expect(result.answer!.responder_verified).toBe(true);
  });

  it("returns timeout result when no answer arrives", async () => {
    const qaGroup = makeGroupResponse({ id: "g-1", type: "qa", my_role: "member" });
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([qaGroup]));

    const questionMsg = makeMessageDataResponse({
      id: "q-1",
      group_id: "g-1",
      message_type: "question",
    });
    deps._api.postMessage.mockResolvedValue({ data: questionMsg });

    const resultPromise = askQuestionHandler(
      { group_id: "g-1", question: "What is the answer?", timeout_seconds: 90 },
      deps,
    );

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(91000);

    const result = await resultPromise;

    expect(result.answered).toBe(false);
    expect(result.question_id).toBe("q-1");
    expect(result.timeout_seconds).toBe(90);
    expect(result.recovery).toBeDefined();
    expect(result.recovery!.retrieval_tool).toBe("meshimize_get_messages");
    expect(result.recovery!.group_id).toBe("g-1");
    expect(result.recovery!.after_message_id).toBe("q-1");
    expect(result.message).toContain("90s");
  });

  it("uses default timeout of 90s when not specified", async () => {
    const qaGroup = makeGroupResponse({ id: "g-1", type: "qa", my_role: "member" });
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([qaGroup]));

    const questionMsg = makeMessageDataResponse({ id: "q-1", message_type: "question" });
    deps._api.postMessage.mockResolvedValue({ data: questionMsg });

    const resultPromise = askQuestionHandler({ group_id: "g-1", question: "What?" }, deps);

    await vi.advanceTimersByTimeAsync(91000);

    const result = await resultPromise;
    expect(result.timeout_seconds).toBe(90);
  });
});

describe("getPendingQuestionsHandler", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("returns buffered unanswered questions for a specific group", async () => {
    const question = makeMessageDataResponse({
      id: "q-1",
      group_id: "g-1",
      message_type: "question",
    });
    deps.messageBuffer.addGroupMessage("g-1", question);

    const result = await getPendingQuestionsHandler({ group_id: "g-1" }, deps);

    expect(result.source).toBe("buffer");
    expect(result.questions).toHaveLength(1);
    expect(deps._api.getMessages).not.toHaveBeenCalled();
  });

  it("falls back to REST API for a specific group when buffer is empty", async () => {
    const metadata = makeMessageMetadataResponse({ message_type: "question" });
    deps._api.getMessages.mockResolvedValue(makePaginatedResponse([metadata]));

    const result = await getPendingQuestionsHandler({ group_id: "g-1" }, deps);

    expect(result.source).toBe("api");
    expect(result.questions).toHaveLength(1);
    expect(deps._api.getMessages).toHaveBeenCalledWith("g-1", {
      unanswered: true,
      limit: 10,
    });
  });

  it("scans all owned/responder QA groups when no group_id", async () => {
    const qaOwned = makeGroupResponse({
      id: "g-qa-owned",
      name: "QA Owned",
      type: "qa",
      my_role: "owner",
    });
    const qaResponder = makeGroupResponse({
      id: "g-qa-resp",
      name: "QA Resp",
      type: "qa",
      my_role: "responder",
    });
    const qaMember = makeGroupResponse({
      id: "g-qa-member",
      name: "QA Member",
      type: "qa",
      my_role: "member",
    });
    const discussion = makeGroupResponse({
      id: "g-disc",
      name: "Discussion",
      type: "open_discussion",
      my_role: "owner",
    });
    deps._api.getMyGroups.mockResolvedValue(
      makePaginatedResponse([qaOwned, qaResponder, qaMember, discussion]),
    );

    // Add a question to owned group buffer
    const question = makeMessageDataResponse({
      id: "q-1",
      group_id: "g-qa-owned",
      message_type: "question",
    });
    deps.messageBuffer.addGroupMessage("g-qa-owned", question);

    // Responder group has no buffered questions, API returns some
    const metadata = makeMessageMetadataResponse({
      id: "q-2",
      group_id: "g-qa-resp",
      message_type: "question",
    });
    deps._api.getMessages.mockResolvedValue(makePaginatedResponse([metadata]));

    const result = await getPendingQuestionsHandler({}, deps);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].group_id).toBe("g-qa-owned");
    expect(result.groups[0].questions).toHaveLength(1);
    expect(result.groups[1].group_id).toBe("g-qa-resp");
    expect(result.groups[1].questions).toHaveLength(1);
  });

  it("excludes QA groups with no unanswered questions", async () => {
    const qaGroup = makeGroupResponse({
      id: "g-qa",
      name: "Empty QA",
      type: "qa",
      my_role: "owner",
    });
    deps._api.getMyGroups.mockResolvedValue(makePaginatedResponse([qaGroup]));
    deps._api.getMessages.mockResolvedValue(makePaginatedResponse([]));

    const result = await getPendingQuestionsHandler({}, deps);

    expect(result.groups).toHaveLength(0);
  });

  it("uses custom limit when provided", async () => {
    deps._api.getMessages.mockResolvedValue(makePaginatedResponse([]));

    await getPendingQuestionsHandler({ group_id: "g-1", limit: 5 }, deps);

    expect(deps._api.getMessages).toHaveBeenCalledWith("g-1", {
      unanswered: true,
      limit: 5,
    });
  });
});

describe("registerMessageTools", () => {
  it("registers all 4 tools with correct names", () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();
    registerMessageTools(pluginApi, deps);

    const toolNames = pluginApi._registeredTools.map((t) => t.name);
    expect(toolNames).toEqual([
      "meshimize_get_messages",
      "meshimize_post_message",
      "meshimize_ask_question",
      "meshimize_get_pending_questions",
    ]);
  });

  it("each tool has a description and parameters", () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();
    registerMessageTools(pluginApi, deps);

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

    deps._api.getMessages.mockRejectedValue(new Error("test-error"));
    deps._api.postMessage.mockRejectedValue(new Error("test-error"));
    deps._api.getMyGroups.mockRejectedValue(new Error("test-error"));

    registerMessageTools(pluginApi, deps);

    // Test get_messages error handling
    const getTool = pluginApi._registeredTools.find((t) => t.name === "meshimize_get_messages")!;
    const getResult = await getTool.execute("test-id", { group_id: "g-1" });
    expect((getResult as Record<string, unknown>).details).toEqual({ error: true });
    const getParsed = JSON.parse(getResult.content[0].text);
    expect(getParsed.error).toBe("Meshimize: test-error");

    // Test post_message error handling
    const postTool = pluginApi._registeredTools.find((t) => t.name === "meshimize_post_message")!;
    const postResult = await postTool.execute("test-id", {
      group_id: "g-1",
      content: "hi",
      message_type: "post",
    });
    expect((postResult as Record<string, unknown>).details).toEqual({ error: true });

    // Test ask_question error handling (membership check fails)
    const askTool = pluginApi._registeredTools.find((t) => t.name === "meshimize_ask_question")!;
    const askResult = await askTool.execute("test-id", { group_id: "g-1", question: "what?" });
    expect((askResult as Record<string, unknown>).details).toEqual({ error: true });

    // Test get_pending_questions error handling
    const pendingTool = pluginApi._registeredTools.find(
      (t) => t.name === "meshimize_get_pending_questions",
    )!;
    const pendingResult = await pendingTool.execute("test-id", { group_id: "g-1" });
    expect((pendingResult as Record<string, unknown>).details).toEqual({ error: true });
  });

  it("get_messages execute returns success result with correct format", async () => {
    const pluginApi = createMockPluginAPI({ apiKey: "mshz_test123" });
    const deps = createDeps();
    deps._api.getMessages.mockResolvedValue(makePaginatedResponse([]));

    registerMessageTools(pluginApi, deps);

    const tool = pluginApi._registeredTools.find((t) => t.name === "meshimize_get_messages")!;
    const result = await tool.execute("test-id", { group_id: "g-1" });

    expect((result as Record<string, unknown>).details).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.messages).toEqual([]);
    expect(parsed.source).toBe("api");
    expect(parsed.has_more).toBe(false);
  });
});
