import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, clearOneDriveSettings, fetchProviders } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("preserves structured errors and remains compatible with Error.message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "PREVIEW_EXPIRED",
        message: "Preview has expired",
        details: { request_id: "request-1", retryable: true },
      },
    }), { status: 409 })));

    const error: unknown = await fetchProviders().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: "ApiError",
      status: 409,
      code: "PREVIEW_EXPIRED",
      message: "Preview has expired",
      details: { request_id: "request-1", retryable: true },
    });
  });

  it.each([
    "<html>Bad gateway</html>",
    "null",
    "[]",
    JSON.stringify({ error: null }),
    JSON.stringify({ error: { message: 42, code: [], details: [] } }),
    JSON.stringify({ error: { message: "  ", code: "", details: null } }),
  ])("falls back safely for a non-standard response: %s", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 502 })));

    await expect(fetchProviders()).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      code: null,
      message: "Request failed (502)",
      details: {},
    });
  });

  it("preserves a message when optional error metadata is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Authorization required" },
    }), { status: 401 })));

    await expect(fetchProviders()).rejects.toMatchObject({
      status: 401,
      message: "Authorization required",
      code: null,
      details: {},
    });
  });

  it("keeps successful JSON responses unchanged", async () => {
    const providers = [{ id: "local", name: "Local Files", writable: true }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(providers)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchProviders()).resolves.toEqual(providers);
    expect(fetchMock).toHaveBeenCalledWith("/api/providers", undefined);
  });

  it("does not parse an empty 204 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(clearOneDriveSettings()).resolves.toBeUndefined();
  });

  it("keeps network failures distinct from HTTP API errors", async () => {
    const networkError = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    await expect(fetchProviders()).rejects.toBe(networkError);
  });
});
