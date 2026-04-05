/**
 * Phoenix Channels v2 wire protocol types.
 *
 * Vendored from meshimize-mcp/src/types/channels.ts.
 * The v2 wire format uses 5-element JSON arrays for all messages.
 */

/** v2 wire format: [join_ref, ref, topic, event, payload] */
export type PhoenixMessage = [
  string | null, // join_ref
  string | null, // ref
  string, // topic
  string, // event
  unknown, // payload
];

export interface PhoenixReplyPayload {
  status: "ok" | "error";
  response: Record<string, unknown>;
}

export type TopicPattern = `group:${string}` | `account:${string}` | "phoenix";
