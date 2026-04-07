import { describe, it, expect, vi } from "vitest";
import { MeshimizeAPI, MeshimizeAPIError } from "../../src/api/client.js";

describe("MeshimizeAPIError", () => {
  it("extracts message from error.error string", () => {
    const err = new MeshimizeAPIError(401, { error: "Invalid API key" });
    expect(err.message).toBe("Invalid API key");
    expect(err.status).toBe(401);
    expect(err.name).toBe("MeshimizeAPIError");
  });

  it("extracts message from error.error.message", () => {
    const err = new MeshimizeAPIError(422, {
      error: { message: "Validation failed" },
    });
    expect(err.message).toBe("Validation failed");
  });

  it("extracts message from error.message (top-level)", () => {
    const err = new MeshimizeAPIError(500, { message: "Internal server error" });
    expect(err.message).toBe("Internal server error");
  });

  it("falls back to HTTP status when body is not parseable", () => {
    const err = new MeshimizeAPIError(503, "not json");
    expect(err.message).toBe("HTTP 503");
  });

  it("serializes error object to JSON as fallback", () => {
    const err = new MeshimizeAPIError(400, { error: { code: 42 } });
    expect(err.message).toBe('{"code":42}');
  });

  it("preserves responseBody", () => {
    const body = { error: "test", details: [1, 2, 3] };
    const err = new MeshimizeAPIError(400, body);
    expect(err.responseBody).toEqual(body);
  });
});

describe("MeshimizeAPI", () => {
  it("constructs without error", () => {
    const client = new MeshimizeAPI({
      apiKey: "mshz_test",
      baseUrl: "https://api.meshimize.com",
      wsUrl: "wss://api.meshimize.com/api/v1/ws/websocket",
    });
    expect(client).toBeInstanceOf(MeshimizeAPI);
  });

  it("is a class with expected API methods", () => {
    const client = new MeshimizeAPI({
      apiKey: "mshz_test",
      baseUrl: "https://api.meshimize.com",
      wsUrl: "wss://api.meshimize.com/api/v1/ws/websocket",
    });
    expect(typeof client.getAccount).toBe("function");
    expect(typeof client.searchGroups).toBe("function");
    expect(typeof client.getMyGroups).toBe("function");
    expect(typeof client.joinGroup).toBe("function");
    expect(typeof client.leaveGroup).toBe("function");
    expect(typeof client.getMessages).toBe("function");
    expect(typeof client.postMessage).toBe("function");
    expect(typeof client.getDirectMessages).toBe("function");
    expect(typeof client.sendDirectMessage).toBe("function");
    expect(typeof client.createDelegation).toBe("function");
    expect(typeof client.listDelegations).toBe("function");
    expect(typeof client.getDelegation).toBe("function");
    expect(typeof client.acceptDelegation).toBe("function");
    expect(typeof client.completeDelegation).toBe("function");
    expect(typeof client.cancelDelegation).toBe("function");
    expect(typeof client.acknowledgeDelegation).toBe("function");
    expect(typeof client.extendDelegation).toBe("function");
  });

  it("retries on network failure and succeeds on subsequent attempt", async () => {
    const client = new MeshimizeAPI({
      apiKey: "mshz_test",
      baseUrl: "https://api.meshimize.com",
      wsUrl: "wss://api.meshimize.com/api/v1/ws/websocket",
    });

    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError("fetch failed");
      }
      return new Response(JSON.stringify({ data: { id: "acc_123" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const result = await client.getAccount();
      expect(result).toEqual({ data: { id: "acc_123" } });
      expect(callCount).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws network error after all retries exhausted", async () => {
    const client = new MeshimizeAPI({
      apiKey: "mshz_test",
      baseUrl: "https://api.meshimize.com",
      wsUrl: "wss://api.meshimize.com/api/v1/ws/websocket",
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    try {
      await expect(client.getAccount()).rejects.toThrow("fetch failed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("MeshimizeAPI invalidKey fast-fail", () => {
  it("invalidKey is false initially", () => {
    const client = new MeshimizeAPI({
      apiKey: "mshz_test",
      baseUrl: "https://api.meshimize.com",
      wsUrl: "wss://api.meshimize.com/api/v1/ws/websocket",
    });
    expect(client.invalidKey).toBe(false);
  });

  it("sets invalidKey to true on 401 response", async () => {
    const client = new MeshimizeAPI({
      apiKey: "mshz_test",
      baseUrl: "https://api.meshimize.com",
      wsUrl: "wss://api.meshimize.com/api/v1/ws/websocket",
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "Invalid API key" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await expect(client.getAccount()).rejects.toThrow();
      expect(client.invalidKey).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fast-fails on subsequent calls after 401 without making network request", async () => {
    const client = new MeshimizeAPI({
      apiKey: "mshz_test",
      baseUrl: "https://api.meshimize.com",
      wsUrl: "wss://api.meshimize.com/api/v1/ws/websocket",
    });

    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "Invalid API key" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    globalThis.fetch = mockFetch;

    try {
      // First call — hits network, gets 401
      await expect(client.getAccount()).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Reset mock call count
      mockFetch.mockClear();

      // Second call — should fast-fail without network
      await expect(client.getAccount()).rejects.toThrow("Invalid or expired API key");
      expect(mockFetch).toHaveBeenCalledTimes(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does NOT set invalidKey on non-401 errors", async () => {
    const client = new MeshimizeAPI({
      apiKey: "mshz_test",
      baseUrl: "https://api.meshimize.com",
      wsUrl: "wss://api.meshimize.com/api/v1/ws/websocket",
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await expect(client.getAccount()).rejects.toThrow();
      expect(client.invalidKey).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("MeshimizeAPI configBaseUrl", () => {
  it("returns baseUrl without /api/v1 suffix", () => {
    const client = new MeshimizeAPI({
      apiKey: "mshz_test",
      baseUrl: "https://api.meshimize.com",
      wsUrl: "wss://api.meshimize.com/api/v1/ws/websocket",
    });
    expect(client.configBaseUrl).toBe("https://api.meshimize.com");
  });

  it("handles localhost baseUrl", () => {
    const client = new MeshimizeAPI({
      apiKey: "mshz_test",
      baseUrl: "http://localhost:4000",
      wsUrl: "ws://localhost:4000/api/v1/ws/websocket",
    });
    expect(client.configBaseUrl).toBe("http://localhost:4000");
  });
});
