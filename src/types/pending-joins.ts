/**
 * Pending join request type for operator-gated join flow.
 *
 * Adapted from meshimize-mcp's PendingJoinRequest (originally in workflow.ts).
 * Stripped of MCP-specific authority workflow fields.
 */

export interface PendingJoinRequest {
  id: string;
  group_id: string;
  group_name: string;
  group_type: "open_discussion" | "qa" | "announcement";
  group_description: string | null;
  owner_account_id: string;
  owner_display_name: string;
  owner_verified: boolean;
  created_at: string; // ISO 8601
}
