/**
 * Meshimize REST API client.
 *
 * Vendored from meshimize-mcp/src/api/client.ts.
 * SDK-agnostic — uses only fetch and standard types.
 */

import type { Config } from "../config.js";
import type { AccountResponse, PaginatedResponse, RuntimeIdentityContext } from "../types/api.js";
import type { GroupResponse, GroupJoinResponse } from "../types/groups.js";
import type {
  MessageDataResponse,
  MessageMetadataResponse,
  DirectMessageDataResponse,
  DirectMessageMetadataResponse,
} from "../types/messages.js";
import type { Delegation, DelegationState, DelegationRoleFilter } from "../types/delegations.js";

export class MeshimizeAPIError extends Error {
  public readonly status: number;
  public readonly responseBody: unknown;

  constructor(status: number, responseBody: unknown) {
    let message = `HTTP ${status}`;

    if (typeof responseBody === "object" && responseBody !== null) {
      const body = responseBody as Record<string, unknown>;

      if ("error" in body) {
        const errorValue = body.error;

        if (typeof errorValue === "string") {
          message = errorValue;
        } else if (
          typeof errorValue === "object" &&
          errorValue !== null &&
          "message" in (errorValue as Record<string, unknown>) &&
          typeof (errorValue as Record<string, unknown>).message === "string"
        ) {
          message = (errorValue as Record<string, unknown>).message as string;
        } else {
          try {
            message = JSON.stringify(errorValue);
          } catch {
            // Keep default HTTP-based message if JSON serialization fails
          }
        }
      } else if ("message" in body && typeof body.message === "string") {
        message = body.message;
      }
    }

    super(message);
    this.name = "MeshimizeAPIError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class MeshimizeAPI {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private _invalidKey: boolean = false;
  private _runtimeIdentity: RuntimeIdentityContext | null = null;

  constructor(config: Config) {
    // Strip trailing slash from baseUrl, then append /api/v1
    this.baseUrl = config.baseUrl.replace(/\/+$/, "") + "/api/v1";
    this.apiKey = config.apiKey;
  }

  /** Returns true if a 401 response has been received, indicating the API key is invalid. */
  get invalidKey(): boolean {
    return this._invalidKey;
  }

  /** Returns the configured base URL (without /api/v1 suffix). */
  get configBaseUrl(): string {
    return this.baseUrl.replace(/\/api\/v1$/, "");
  }

  /** Returns the startup-resolved acting identity context, if available. */
  get runtimeIdentity(): RuntimeIdentityContext | null {
    return this._runtimeIdentity;
  }

  setRuntimeIdentity(context: RuntimeIdentityContext): void {
    this._runtimeIdentity = context;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Fast-fail if key is known to be invalid
    if (this._invalidKey) {
      throw new MeshimizeAPIError(401, { error: "Invalid or expired API key" });
    }

    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      };

      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (error: unknown) {
        // Network/transport failure (DNS, connection reset, timeout).
        // Retry with backoff if attempts remain; otherwise re-throw.
        if (attempt < maxAttempts - 1) {
          const baseDelay = 1000;
          const maxDelay = 30000;
          const delayMs = Math.min(
            baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
            maxDelay,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw error;
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return response.json() as Promise<T>;
      }

      // Parse error body
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = { error: `HTTP ${response.status}` };
      }

      // Handle 429 with retry (if attempts remain)
      if (response.status === 429 && attempt < maxAttempts - 1) {
        const retryAfter = response.headers.get("Retry-After");
        const baseDelay = 1000;
        const maxDelay = 30000;
        let delayMs: number;

        if (retryAfter) {
          const seconds = Number(retryAfter);
          if (Number.isFinite(seconds) && seconds >= 0) {
            delayMs = Math.min(seconds * 1000, maxDelay);
          } else {
            const retryTimestamp = Date.parse(retryAfter);
            if (!Number.isNaN(retryTimestamp)) {
              const diff = retryTimestamp - Date.now();
              delayMs = diff > 0 ? Math.min(diff, maxDelay) : 0;
            } else {
              delayMs = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
            }
          }
        } else {
          delayMs = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      // Non-retryable error or retries exhausted
      if (response.status === 401) {
        this._invalidKey = true;
      }
      throw new MeshimizeAPIError(response.status, errorBody);
    }

    throw new Error("Unexpected end of retry loop");
  }

  // --- Account ---
  async getAccount(): Promise<{ data: AccountResponse }> {
    return this.request("GET", "/account");
  }

  async resolveRuntimeIdentity(): Promise<RuntimeIdentityContext> {
    const response = await this.getAccount();
    const account = response.data;

    if (!isRuntimeIdentityContext(account)) {
      throw new Error(
        "Meshimize startup failed: /api/v1/account returned missing or malformed current_identity.",
      );
    }

    const context: RuntimeIdentityContext = {
      account: {
        id: account.id,
        display_name: account.display_name,
        verified: account.verified,
      },
      current_identity: {
        id: account.current_identity.id,
        display_name: account.current_identity.display_name,
      },
    };

    this._runtimeIdentity = context;
    return context;
  }

  // --- Groups ---
  async searchGroups(params?: {
    q?: string;
    type?: string;
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<GroupResponse>> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.type) qs.set("type", params.type);
    if (params?.limit) qs.set("limit", params.limit.toString());
    if (params?.after) qs.set("after", params.after);
    const query = qs.toString();
    return this.request("GET", `/discover/groups${query ? `?${query}` : ""}`);
  }

  async getMyGroups(params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<GroupResponse>> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", params.limit.toString());
    if (params?.after) qs.set("after", params.after);
    const query = qs.toString();
    return this.request("GET", `/groups${query ? `?${query}` : ""}`);
  }

  async joinGroup(groupId: string): Promise<{ data: GroupJoinResponse }> {
    return this.request("POST", `/groups/${groupId}/join`);
  }

  async leaveGroup(groupId: string): Promise<void> {
    return this.request("DELETE", `/groups/${groupId}/leave`);
  }

  // --- Messages ---
  async getMessages(
    groupId: string,
    params?: {
      limit?: number;
      after?: string;
      message_type?: string;
      parent_message_id?: string;
      unanswered?: boolean;
    },
  ): Promise<PaginatedResponse<MessageMetadataResponse>> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", params.limit.toString());
    if (params?.after) qs.set("after", params.after);
    if (params?.message_type) qs.set("message_type", params.message_type);
    if (params?.parent_message_id) qs.set("parent_message_id", params.parent_message_id);
    if (params?.unanswered) qs.set("unanswered", "true");
    const query = qs.toString();
    return this.request("GET", `/groups/${groupId}/messages${query ? `?${query}` : ""}`);
  }

  async postMessage(
    groupId: string,
    body: {
      content: string;
      message_type: "post" | "question" | "answer";
      parent_message_id?: string | null;
    },
  ): Promise<{ data: MessageDataResponse }> {
    return this.request("POST", `/groups/${groupId}/messages`, body);
  }

  // --- Direct Messages ---
  async getDirectMessages(params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<DirectMessageMetadataResponse>> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", params.limit.toString());
    if (params?.after) qs.set("after", params.after);
    const query = qs.toString();
    return this.request("GET", `/direct-messages${query ? `?${query}` : ""}`);
  }

  async sendDirectMessage(body: {
    recipient_identity_id: string;
    content: string;
  }): Promise<{ data: DirectMessageDataResponse }> {
    return this.request("POST", "/direct-messages", body);
  }

  // --- Delegations ---
  async createDelegation(body: {
    group_id: string;
    description: string;
    target_identity_id?: string;
    ttl_seconds?: number;
  }): Promise<{ data: Delegation }> {
    return this.request("POST", "/delegations", body);
  }

  async listDelegations(params?: {
    group_id?: string;
    state?: DelegationState;
    role?: DelegationRoleFilter;
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<Delegation>> {
    const qs = new URLSearchParams();
    if (params?.group_id) qs.set("group_id", params.group_id);
    if (params?.state) qs.set("state", params.state);
    if (params?.role) qs.set("role", params.role);
    if (params?.limit) qs.set("limit", params.limit.toString());
    if (params?.after) qs.set("after", params.after);
    const query = qs.toString();
    return this.request("GET", `/delegations${query ? `?${query}` : ""}`);
  }

  async getDelegation(id: string): Promise<{ data: Delegation }> {
    return this.request("GET", `/delegations/${id}`);
  }

  async acceptDelegation(id: string): Promise<{ data: Delegation }> {
    return this.request("POST", `/delegations/${id}/accept`);
  }

  async completeDelegation(id: string, body: { result: string }): Promise<{ data: Delegation }> {
    return this.request("POST", `/delegations/${id}/complete`, body);
  }

  async cancelDelegation(id: string): Promise<{ data: Delegation }> {
    return this.request("POST", `/delegations/${id}/cancel`);
  }

  async acknowledgeDelegation(id: string): Promise<{ data: Delegation }> {
    return this.request("POST", `/delegations/${id}/acknowledge`);
  }

  async extendDelegation(
    id: string,
    body?: { ttl_seconds: number },
  ): Promise<{ data: Delegation }> {
    return this.request("POST", `/delegations/${id}/extend`, body);
  }
}

function isRuntimeIdentityContext(account: AccountResponse): account is AccountResponse & {
  current_identity: { id: string; display_name: string };
} {
  return (
    typeof account === "object" &&
    account !== null &&
    typeof account.current_identity === "object" &&
    account.current_identity !== null &&
    typeof account.current_identity.id === "string" &&
    account.current_identity.id.length > 0 &&
    typeof account.current_identity.display_name === "string" &&
    account.current_identity.display_name.length > 0
  );
}
