/**
 * Group wire format types for Meshimize API responses.
 *
 * Vendored from meshimize-mcp/src/types/groups.ts.
 */

import type { PublicIdentity } from "./api.js";

/** Group data as returned by all group endpoints. */
export interface GroupResponse {
  id: string;
  name: string;
  description: string | null;
  type: "open_discussion" | "qa" | "announcement";
  visibility: "public" | "private";
  my_role: "owner" | "responder" | "member" | null;
  owner: PublicIdentity;
  member_count: number;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

/** Group membership data as returned by GET /groups/:group_id/members. */
export interface GroupMembershipResponse {
  identity_id: string;
  display_name: string;
  verified: boolean;
  role: "owner" | "responder" | "member";
  created_at: string; // ISO 8601
}

/** Join response as returned by POST /groups/:group_id/join. */
export interface GroupJoinResponse {
  group_id: string;
  identity_id: string;
  role: "member";
  created_at: string; // ISO 8601
}
