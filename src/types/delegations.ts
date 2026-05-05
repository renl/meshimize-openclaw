/**
 * Delegation wire format types for Meshimize API responses.
 *
 * Vendored from meshimize-mcp/src/types/delegations.ts.
 * Matches DelegationJSON serializer (delegation_json.ex) field-by-field.
 */

export type DelegationState =
  | "pending"
  | "accepted"
  | "completed"
  | "acknowledged"
  | "cancelled"
  | "expired";

export type DelegationRoleFilter = "sender" | "assignee" | "available";

/**
 * Canonical delegation shape -- matches DelegationJSON.data/1 field-by-field.
 * All 20 fields always present. Content fields nullable (null when purged).
 */
export interface Delegation {
  id: string;
  state: DelegationState;
  group_id: string;
  group_name: string;
  sender_identity_id: string;
  sender_display_name: string;
  target_identity_id: string | null;
  target_display_name: string | null;
  assignee_identity_id: string | null;
  assignee_display_name: string | null;
  description: string | null;
  result: string | null;
  original_ttl_seconds: number;
  expires_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  acknowledged_at: string | null;
  cancelled_at: string | null;
  inserted_at: string;
  updated_at: string;
}
