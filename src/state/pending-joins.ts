import crypto from "node:crypto";
import type { PendingJoinRequest } from "../types/pending-joins.js";

/**
 * Configuration subset required by PendingJoinMap.
 * Kept separate from the plugin's main Config to avoid coupling.
 */
export interface PendingJoinConfig {
  joinTimeoutMs: number;
  maxPendingJoins: number;
}

/** Default configuration values matching meshimize-mcp defaults. */
export const PENDING_JOIN_DEFAULTS: PendingJoinConfig = {
  joinTimeoutMs: 600_000, // 10 minutes
  maxPendingJoins: 50,
};

interface PendingJoinGroupInput {
  id: string;
  name: string;
  description: string | null;
  type: PendingJoinRequest["group_type"];
  owner: {
    id: string;
    display_name: string;
    verified: boolean;
  };
}

export interface PendingJoinMap {
  add(group: PendingJoinGroupInput): PendingJoinRequest;
  getByGroupId(groupId: string): PendingJoinRequest | undefined;
  getById(id: string): PendingJoinRequest | undefined;
  remove(groupId: string): void;
  listPending(): PendingJoinRequest[];
  pruneExpired(): number;
  dispose(): void;
}

export interface PendingJoinMapCallbacks {
  onExpired?: (request: PendingJoinRequest) => void;
  onRemoved?: (request: PendingJoinRequest) => void;
}

class PendingJoinMapImpl implements PendingJoinMap {
  private readonly map = new Map<string, PendingJoinRequest>();
  private readonly joinTimeoutMs: number;
  private readonly maxPendingJoins: number;
  private pruneInterval: ReturnType<typeof setInterval> | null;

  constructor(
    config: PendingJoinConfig,
    private readonly callbacks?: PendingJoinMapCallbacks,
  ) {
    if (
      !Number.isFinite(config.joinTimeoutMs) ||
      !Number.isInteger(config.joinTimeoutMs) ||
      config.joinTimeoutMs <= 0
    ) {
      throw new RangeError(
        `joinTimeoutMs must be a finite positive integer, got: ${config.joinTimeoutMs}`,
      );
    }
    if (
      !Number.isFinite(config.maxPendingJoins) ||
      !Number.isInteger(config.maxPendingJoins) ||
      config.maxPendingJoins <= 0
    ) {
      throw new RangeError(
        `maxPendingJoins must be a finite positive integer, got: ${config.maxPendingJoins}`,
      );
    }
    this.joinTimeoutMs = config.joinTimeoutMs;
    this.maxPendingJoins = config.maxPendingJoins;
    this.pruneInterval = setInterval(() => this.pruneExpired(), 60_000);
    this.pruneInterval.unref?.();
  }

  add(group: PendingJoinGroupInput): PendingJoinRequest {
    this.pruneExpired();

    const existing = this.map.get(group.id);
    if (existing) {
      return existing;
    }

    if (this.map.size >= this.maxPendingJoins) {
      throw new Error(
        `Cannot add pending join request: maximum number of pending requests (${this.maxPendingJoins}) reached`,
      );
    }

    const now = Date.now();
    const request: PendingJoinRequest = {
      id: crypto.randomUUID(),
      group_id: group.id,
      group_name: group.name,
      group_type: group.type,
      group_description: group.description,
      owner_account_id: group.owner.id,
      owner_display_name: group.owner.display_name,
      owner_verified: group.owner.verified,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + this.joinTimeoutMs).toISOString(),
    };

    const frozen = Object.freeze(request);
    this.map.set(group.id, frozen);
    return frozen;
  }

  getByGroupId(groupId: string): PendingJoinRequest | undefined {
    this.pruneExpired();
    return this.map.get(groupId);
  }

  getById(id: string): PendingJoinRequest | undefined {
    this.pruneExpired();
    for (const entry of this.map.values()) {
      if (entry.id === id) {
        return entry;
      }
    }
    return undefined;
  }

  remove(groupId: string): void {
    this.pruneExpired();
    const existing = this.map.get(groupId);
    if (existing) {
      this.map.delete(groupId);
      this.callbacks?.onRemoved?.(existing);
    }
  }

  listPending(): PendingJoinRequest[] {
    this.pruneExpired();
    return [...this.map.values()];
  }

  pruneExpired(): number {
    let count = 0;
    const now = Date.now();
    for (const [groupId, entry] of this.map.entries()) {
      if (new Date(entry.expires_at).getTime() <= now) {
        this.map.delete(groupId);
        this.callbacks?.onExpired?.(entry);
        count++;
      }
    }
    return count;
  }

  dispose(): void {
    if (this.pruneInterval !== null) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
    this.map.clear();
  }
}

export function createPendingJoinMap(
  config: PendingJoinConfig,
  callbacks?: PendingJoinMapCallbacks,
): PendingJoinMap {
  return new PendingJoinMapImpl(config, callbacks);
}
