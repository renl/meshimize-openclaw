import { describe, it, expect } from "vitest";
import { MeshimizeAPIError } from "../src/api/client.js";
import { formatToolError, successResult, errorResult } from "../src/errors.js";

describe("formatToolError", () => {
  const baseUrl = "https://api.meshimize.com";

  describe("MeshimizeAPIError mapping", () => {
    it("maps 401 to fixed invalid key message", () => {
      const error = new MeshimizeAPIError(401, { error: "Invalid API key" });
      expect(formatToolError(error, baseUrl)).toBe("Meshimize: Invalid or expired API key");
    });

    it("maps 401 with any server message to fixed invalid key message", () => {
      const error = new MeshimizeAPIError(401, { error: "Token expired" });
      expect(formatToolError(error, baseUrl)).toBe("Meshimize: Invalid or expired API key");
    });

    it("maps 403 with server error message", () => {
      const error = new MeshimizeAPIError(403, { error: "Forbidden" });
      expect(formatToolError(error, baseUrl)).toBe("Meshimize: Forbidden");
    });

    it("maps 404 with server error message", () => {
      const error = new MeshimizeAPIError(404, { error: "Not found" });
      expect(formatToolError(error, baseUrl)).toBe("Meshimize: Not found");
    });

    it("maps 409 with server error message", () => {
      const error = new MeshimizeAPIError(409, { error: "Already accepted" });
      expect(formatToolError(error, baseUrl)).toBe("Meshimize: Already accepted");
    });

    it("maps 422 with server error message", () => {
      const error = new MeshimizeAPIError(422, { error: "Validation failed" });
      expect(formatToolError(error, baseUrl)).toBe("Meshimize: Validation failed");
    });

    it("maps 429 to fixed rate limit message", () => {
      const error = new MeshimizeAPIError(429, { error: "Rate limit exceeded" });
      expect(formatToolError(error, baseUrl)).toBe(
        "Meshimize: Rate limit exceeded. Try again later.",
      );
    });

    it("maps 500 to fixed server error message", () => {
      const error = new MeshimizeAPIError(500, { message: "Internal server error" });
      expect(formatToolError(error, baseUrl)).toBe("Meshimize: Server error");
    });

    it("maps 502 to fixed server error message", () => {
      const error = new MeshimizeAPIError(502, "bad gateway");
      expect(formatToolError(error, baseUrl)).toBe("Meshimize: Server error");
    });

    it("maps 503 to fixed server error message", () => {
      const error = new MeshimizeAPIError(503, {});
      expect(formatToolError(error, baseUrl)).toBe("Meshimize: Server error");
    });
  });

  describe("network errors", () => {
    it("maps TypeError (fetch failed) to unable to reach server", () => {
      const error = new TypeError("fetch failed");
      expect(formatToolError(error, baseUrl)).toBe(
        "Meshimize: Unable to reach server at https://api.meshimize.com",
      );
    });

    it("maps ECONNREFUSED error to unable to reach server", () => {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:4000");
      expect(formatToolError(error, "http://localhost:4000")).toBe(
        "Meshimize: Unable to reach server at http://localhost:4000",
      );
    });

    it("maps ENOTFOUND error to unable to reach server", () => {
      const error = new Error("getaddrinfo ENOTFOUND api.meshimize.com");
      expect(formatToolError(error, baseUrl)).toBe(
        "Meshimize: Unable to reach server at https://api.meshimize.com",
      );
    });

    it("does NOT treat a plain TypeError as a network error", () => {
      const error = new TypeError("Cannot read properties of undefined (reading 'foo')");
      expect(formatToolError(error, baseUrl)).toBe(
        "Meshimize: Cannot read properties of undefined (reading 'foo')",
      );
    });

    it("maps TypeError with cause containing ECONNREFUSED to network error", () => {
      const error = new TypeError("fetch failed");
      error.cause = new Error("connect ECONNREFUSED 127.0.0.1:4000");
      expect(formatToolError(error, baseUrl)).toBe(
        "Meshimize: Unable to reach server at https://api.meshimize.com",
      );
    });

    it("maps TypeError with cause containing ECONNRESET to network error", () => {
      const error = new TypeError("terminated");
      error.cause = new Error("ECONNRESET");
      expect(formatToolError(error, baseUrl)).toBe(
        "Meshimize: Unable to reach server at https://api.meshimize.com",
      );
    });

    it("maps TypeError with cause containing ETIMEDOUT to network error", () => {
      const error = new TypeError("terminated");
      error.cause = new Error("connect ETIMEDOUT 10.0.0.1:443");
      expect(formatToolError(error, baseUrl)).toBe(
        "Meshimize: Unable to reach server at https://api.meshimize.com",
      );
    });
  });

  describe("business logic errors", () => {
    it("prefixes regular Error message with Meshimize:", () => {
      const error = new Error("Group not found or is not public.");
      expect(formatToolError(error, baseUrl)).toBe("Meshimize: Group not found or is not public.");
    });

    it("prefixes handler error with Meshimize:", () => {
      const error = new Error("No pending join request found for this group.");
      expect(formatToolError(error, baseUrl)).toBe(
        "Meshimize: No pending join request found for this group.",
      );
    });
  });

  describe("unknown errors", () => {
    it("maps string thrown value to unknown error", () => {
      expect(formatToolError("string error", baseUrl)).toBe("Meshimize: Unknown error");
    });

    it("maps null thrown value to unknown error", () => {
      expect(formatToolError(null, baseUrl)).toBe("Meshimize: Unknown error");
    });

    it("maps undefined thrown value to unknown error", () => {
      expect(formatToolError(undefined, baseUrl)).toBe("Meshimize: Unknown error");
    });
  });
});

describe("successResult", () => {
  it("wraps data as JSON text content", () => {
    const result = successResult({ foo: "bar" });
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ foo: "bar" }, null, 2) }],
    });
  });

  it("does not set isError", () => {
    const result = successResult("ok");
    expect(result.isError).toBeUndefined();
  });
});

describe("errorResult", () => {
  it("wraps message as JSON error with isError flag", () => {
    const result = errorResult("something went wrong");
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ error: "something went wrong" }) }],
      isError: true,
    });
  });
});
