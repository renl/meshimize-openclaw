/**
 * Messaging tools for the Meshimize OpenClaw plugin.
 *
 * Registers 4 tools via `api.registerTool()`:
 *   - meshimize_get_messages
 *   - meshimize_post_message
 *   - meshimize_ask_question
 *   - meshimize_get_pending_questions
 *
 * Adapted from meshimize-mcp/src/tools/messages.ts with all MCP-specific
 * state removed (authority lookups, membership paths, workflow recorder,
 * authority session context).
 */

import { Type } from "@sinclair/typebox";
import type { PluginAPI } from "openclaw/plugin-sdk/types";
import type { MeshimizeAPI } from "../api/client.js";
import type { MessageBuffer } from "../buffer/message-buffer.js";
import { findMyGroupById } from "./groups.js";
import { successResult, errorResult, formatToolError } from "../errors.js";

// ---------------------------------------------------------------------------
// Dependencies interface
// ---------------------------------------------------------------------------

export interface MessageToolDeps {
  api: MeshimizeAPI;
  messageBuffer: MessageBuffer;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Handler functions (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Retrieves recent messages from a group.
 * Checks buffer first (full content), falls back to REST API (metadata only).
 */
export async function getMessagesHandler(
  args: { group_id: string; after_message_id?: string; limit?: number },
  deps: MessageToolDeps,
) {
  const buffered = deps.messageBuffer.getGroupMessages(args.group_id, {
    afterMessageId: args.after_message_id,
    limit: args.limit,
  });

  if (buffered.length > 0) {
    return { messages: buffered, source: "buffer", has_more: false };
  }

  const result = await deps.api.getMessages(args.group_id, {
    after: args.after_message_id,
    limit: args.limit,
  });

  return { messages: result.data, source: "api", has_more: result.meta.has_more };
}

/**
 * Posts a message to a group.
 */
export async function postMessageHandler(
  args: {
    group_id: string;
    content: string;
    message_type: "post" | "question" | "answer";
    parent_message_id?: string;
  },
  deps: MessageToolDeps,
) {
  const result = await deps.api.postMessage(args.group_id, {
    content: args.content,
    message_type: args.message_type,
    parent_message_id: args.parent_message_id ?? null,
  });

  return { message: result.data };
}

/**
 * Asks a Q&A group and waits for a live answer via the message buffer.
 * Verifies membership and group type before posting.
 * Stripped: provenance, authority continuation, membership path tracking, workflow recording.
 */
export async function askQuestionHandler(
  args: { group_id: string; question: string; timeout_seconds?: number },
  deps: MessageToolDeps,
) {
  // 1. Verify membership
  const membership = await findMyGroupById(deps.api, args.group_id);
  if (!membership) {
    throw new Error(
      "You are not currently a member of this group. " +
        "Call `meshimize_join_group` first, then get operator approval via `meshimize_approve_join`.",
    );
  }

  // 2. Verify group type
  if (membership.type !== "qa") {
    throw new Error("`meshimize_ask_question` is only valid for Q&A groups.");
  }

  // 3. Set timeout
  const timeoutSeconds = args.timeout_seconds ?? 90;
  const timeoutMs = timeoutSeconds * 1000;

  // 4. Post question
  const questionResult = await deps.api.postMessage(args.group_id, {
    content: args.question,
    message_type: "question",
    parent_message_id: null,
  });
  const questionId = questionResult.data.id;

  // 5. Poll loop
  const pollInterval = 500;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const answers = deps.messageBuffer.getGroupMessages(args.group_id, {
      messageType: "answer",
      parentMessageId: questionId,
    });

    if (answers.length > 0) {
      const answer = answers[0];
      return {
        answered: true,
        question_id: questionId,
        group_id: args.group_id,
        timeout_seconds: timeoutSeconds,
        answer: {
          id: answer.id,
          content: answer.content,
          responder_identity_id: answer.sender.id,
          responder_display_name: answer.sender.display_name,
          responder_verified: answer.sender.verified,
          created_at: answer.created_at,
        },
      };
    }

    await sleep(pollInterval);
  }

  // 6. Timeout
  return {
    answered: false,
    question_id: questionId,
    group_id: args.group_id,
    timeout_seconds: timeoutSeconds,
    recovery: {
      retrieval_tool: "meshimize_get_messages",
      group_id: args.group_id,
      after_message_id: questionId,
      match_parent_message_id: questionId,
      instructions:
        "Call meshimize_get_messages with the group_id and after_message_id above, " +
        "then look for an answer with parent_message_id matching the question_id.",
    },
    message: `No answer received within ${timeoutSeconds}s. Use the recovery instructions to check for a late answer.`,
  };
}

/**
 * Retrieves unanswered questions from Q&A groups.
 * If group_id provided, checks that single group. Otherwise scans all owned/responder QA groups.
 */
export async function getPendingQuestionsHandler(
  args: { group_id?: string; limit?: number },
  deps: MessageToolDeps,
) {
  const limit = args.limit ?? 10;

  if (args.group_id) {
    // Single group path
    const buffered = deps.messageBuffer.getGroupMessages(args.group_id, {
      unanswered: true,
      limit,
    });

    if (buffered.length > 0) {
      return { questions: buffered, source: "buffer" };
    }

    const result = await deps.api.getMessages(args.group_id, {
      unanswered: true,
      limit,
    });

    return { questions: result.data, source: "api" };
  }

  // Multi-group path: scan all QA groups where we're owner or responder
  const myGroupsResult = await deps.api.getMyGroups({ limit: 100 });
  const qaGroups = myGroupsResult.data.filter(
    (g) => g.type === "qa" && (g.my_role === "owner" || g.my_role === "responder"),
  );

  const groups: Array<{
    group_id: string;
    group_name: string;
    questions: unknown[];
  }> = [];

  for (const group of qaGroups) {
    const buffered = deps.messageBuffer.getGroupMessages(group.id, {
      unanswered: true,
      limit,
    });

    if (buffered.length > 0) {
      groups.push({
        group_id: group.id,
        group_name: group.name,
        questions: buffered,
      });
      continue;
    }

    const result = await deps.api.getMessages(group.id, {
      unanswered: true,
      limit,
    });

    if (result.data.length > 0) {
      groups.push({
        group_id: group.id,
        group_name: group.name,
        questions: result.data,
      });
    }
  }

  return { groups };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Registers all 4 messaging tools with the OpenClaw Gateway.
 * Tool descriptions copied exactly from architecture §2.2.
 */
export function registerMessageTools(api: PluginAPI, deps: MessageToolDeps): void {
  // --- meshimize_get_messages ---
  api.registerTool({
    name: "meshimize_get_messages",
    description:
      "Retrieve recent messages from a group. Reads from local buffer first (includes full content). Falls back to server API which returns metadata only (no message content).",
    parameters: Type.Object({
      group_id: Type.String({
        format: "uuid",
        description: "The UUID of the group",
      }),
      after_message_id: Type.Optional(
        Type.String({
          format: "uuid",
          description: "Return messages after this message ID (for pagination)",
        }),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 100,
          default: 50,
          description: "Max messages to return",
        }),
      ),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      try {
        const result = await getMessagesHandler(
          args as { group_id: string; after_message_id?: string; limit?: number },
          deps,
        );
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_post_message ---
  api.registerTool({
    name: "meshimize_post_message",
    description:
      "Send a message to a group. Use 'question' type for Q&A groups, 'answer' to reply to a question (requires parent_message_id), or 'post' for discussion. Check `meshimize_list_my_groups` first to confirm membership before posting.",
    parameters: Type.Object({
      group_id: Type.String({
        format: "uuid",
        description: "The UUID of the group to post to",
      }),
      content: Type.String({
        minLength: 1,
        maxLength: 32000,
        description: "The message content",
      }),
      message_type: Type.Union(
        [Type.Literal("post"), Type.Literal("question"), Type.Literal("answer")],
        { description: "Type of message" },
      ),
      parent_message_id: Type.Optional(
        Type.String({
          format: "uuid",
          description: "Required for 'answer' type \u2014 the question being answered",
        }),
      ),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      try {
        const result = await postMessageHandler(
          args as {
            group_id: string;
            content: string;
            message_type: "post" | "question" | "answer";
            parent_message_id?: string;
          },
          deps,
        );
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_ask_question ---
  api.registerTool({
    name: "meshimize_ask_question",
    description:
      "Ask a membership-resolved Q&A group directly, including the first ask immediately after operator approval. This tool verifies current membership before posting, waits for a live answer in the local buffer, and returns the answer on success. If no answer arrives in time, it returns recoverable timeout metadata so you can use `meshimize_get_messages` to retrieve a late answer without re-asking. If you're already a member, skip search/join and call this tool directly with the group_id.",
    parameters: Type.Object({
      group_id: Type.String({
        format: "uuid",
        description: "The UUID of the Q&A group",
      }),
      question: Type.String({
        minLength: 1,
        maxLength: 32000,
        description: "The question to ask",
      }),
      timeout_seconds: Type.Optional(
        Type.Integer({
          minimum: 90,
          maximum: 300,
          default: 90,
          description: "How long to wait for an answer (seconds)",
        }),
      ),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      try {
        const result = await askQuestionHandler(
          args as { group_id: string; question: string; timeout_seconds?: number },
          deps,
        );
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });

  // --- meshimize_get_pending_questions ---
  api.registerTool({
    name: "meshimize_get_pending_questions",
    description:
      "Retrieve unanswered questions from Q&A groups where you are an owner or responder. Reads from local buffer (includes content). Falls back to server API (metadata only).",
    parameters: Type.Object({
      group_id: Type.Optional(
        Type.String({
          format: "uuid",
          description:
            "Filter to a specific group. If omitted, returns questions from all your Q&A groups.",
        }),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 100,
          default: 10,
          description: "Max questions to return",
        }),
      ),
    }),
    execute: async (_id: string, args: Record<string, unknown>) => {
      try {
        const result = await getPendingQuestionsHandler(
          args as { group_id?: string; limit?: number },
          deps,
        );
        return successResult(result);
      } catch (error) {
        return errorResult(formatToolError(error, deps.api.configBaseUrl));
      }
    },
  });
}
