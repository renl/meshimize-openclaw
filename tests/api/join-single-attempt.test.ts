// Request-layer proxy with fetch mocked. Physical HTTP counting remains mandatory.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeshimizeAPI } from "../../src/api/client.js";

describe("join request must not inherit automatic retries (US-PGI-8 §4.4.1)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it.each(["network", "429"])("one fetch only on %s", async (fault) => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    if (fault === "network") fetch.mockRejectedValue(new Error("fetch failed"));
    else
      fetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429,
          headers: { "Retry-After": "0" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const api = new MeshimizeAPI({
      apiKey: "mshz_fixture_only",
      baseUrl: "http://example.invalid",
      wsUrl: "ws://example.invalid/api/v1/ws/websocket",
    });
    const result = api.joinGroup("10000000-0000-4000-8000-000000000001").catch((error) => error);
    await vi.runAllTimersAsync();
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(
      "http://example.invalid/api/v1/groups/10000000-0000-4000-8000-000000000001/join",
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer mshz_fixture_only" },
      body: undefined,
    });
  });
});
