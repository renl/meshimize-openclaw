/**
 * Shared wire format types for Meshimize API responses.
 *
 * Vendored from meshimize-mcp/src/types/api.ts.
 */

/** Public-facing identity data used across wire responses. */
export interface PublicIdentity {
  id: string;
  display_name: string;
  verified: boolean;
}

/**
 * Direct-message identity — intentionally different from PublicIdentity.
 * Recipient does NOT include `verified` field.
 */
export interface DirectMessageIdentity {
  id: string;
  display_name: string;
}

/** Acting identity returned by GET /api/v1/account. */
export interface CurrentIdentityResponse {
  id: string;
  display_name: string;
}

/** Minimal operator-facing runtime context resolved at startup. */
export interface RuntimeIdentityContext {
  account: {
    id: string;
    display_name: string;
    verified: boolean;
  };
  current_identity: CurrentIdentityResponse;
}

/** Cursor-based pagination metadata from all list endpoints. */
export interface PaginationMeta {
  has_more: boolean;
  next_cursor: string | null;
  count: number;
}

/** Wrapper for paginated list responses. */
export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

/** Account data (inner `data` object from GET /api/v1/account response). */
export interface AccountResponse {
  id: string;
  email: string;
  display_name: string;
  description: string | null;
  verified: boolean;
  current_identity: CurrentIdentityResponse;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}
