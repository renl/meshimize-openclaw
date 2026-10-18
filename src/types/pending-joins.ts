/**
 * Pending join request type for operator-gated join flow.
 *
 * Adapted from meshimize-mcp's PendingJoinRequest (originally in workflow.ts).
 * Stripped of MCP-specific authority workflow fields.
 */

/** Group type as carried by the Meshimize group wire format. */
export type GroupType = "open_discussion" | "qa" | "announcement";

/**
 * Where the operator-visible metadata came from. `unknown` means the operator
 * supplied an ID that neither configured-identity memberships nor bounded public
 * discovery confirmed; absence is not evidence of private visibility or
 * nonexistence (private-group-invitations §14.2).
 */
export type PendingJoinMetadataSource = "public_discovery" | "unknown";

/**
 * A pending join request awaiting explicit operator approval.
 *
 * Descriptive fields are nullable because an unverified ID-only request must never
 * fabricate a name, type, owner, verification badge, or visibility label; consumers
 * preserve the literal `null`s instead of inventing defaults.
 */
export interface PendingJoinRequest {
  id: string;
  group_id: string;
  metadata_source: PendingJoinMetadataSource;
  group_name: string | null;
  group_type: GroupType | null;
  group_description: string | null;
  owner_account_id: string | null;
  owner_display_name: string | null;
  owner_verified: boolean | null;
  created_at: string; // ISO 8601
  expires_at: string; // ISO 8601
}
