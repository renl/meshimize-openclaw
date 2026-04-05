import { describe, it, expect } from "vitest";
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
});
