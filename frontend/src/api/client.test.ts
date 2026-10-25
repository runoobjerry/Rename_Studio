import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, createStoragePreview, releaseStoragePreview, disconnectStorage, fetchStorages, fetchRenameProgress, fetchAppSettings, patchAppSettings, factoryResetAppSettings } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("reads app settings and submits only changed preference fields", async () => {
    const payload = { preferences: {
      language: "auto", theme: "dark", cloud_default_locations: {},
    } };
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(payload)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAppSettings()).toEqual(payload);
    expect(await patchAppSettings({ theme: "dark" })).toEqual(payload);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/app-settings", undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/app-settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "dark" }),
    });
  });
  it("requests the single factory reset endpoint", async () => {
    const response = { preferences: {
      language: "auto", theme: "system", cloud_default_locations: {},
    } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await factoryResetAppSettings()).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/api/app-settings/factory-reset", { method: "POST" });
  });
  it("passes the replacement ID and releases only the specified preview", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ preview_id: "new" })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await createStoragePreview("connection", { kind: "root" }, ["file"], [], "old");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/storages/connection/rename/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: { kind: "root" }, file_ids: ["file"], rules: [], previous_preview_id: "old" }),
    });
    await releaseStoragePreview("connection", "preview/id");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/storages/connection/rename/previews/preview%2Fid", { method: "DELETE" });
  });
  it("fetches server execution counts with an encoded preview ID", async () => {
    const progress = { preview_id: "preview/id", total: 20, processed: 10, phase: "renaming", error: null };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(progress)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchRenameProgress("preview/id")).toEqual(progress);
    expect(fetchMock).toHaveBeenCalledWith("/api/rename/progress/preview%2Fid", undefined);
  });
  it("preserves structured errors and remains compatible with Error.message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "PREVIEW_EXPIRED",
        message: "Preview has expired",
        details: { request_id: "request-1", retryable: true },
      },
    }), { status: 409 })));

    const error: unknown = await fetchStorages().catch((reason: unknown) => reason);
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
    JSON.stringify({ error: { message: 42, code: [], details: [] } }),
  ])("falls back safely for a non-standard response: %s", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 502 })));

    await expect(fetchStorages()).rejects.toMatchObject({
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

    await expect(fetchStorages()).rejects.toMatchObject({
      status: 401,
      message: "Authorization required",
      code: null,
      details: {},
    });
  });

  it("keeps successful JSON responses unchanged", async () => {
    const providers = [{ storage_id: "default-local", provider_type: "local", name: "Local Files" }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(providers)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchStorages()).resolves.toEqual(providers);
    expect(fetchMock).toHaveBeenCalledWith("/api/storages", undefined);
  });

  it("does not parse an empty 204 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(disconnectStorage("account-connection")).resolves.toBeUndefined();
  });

  it("keeps network failures distinct from HTTP API errors", async () => {
    const networkError = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    await expect(fetchStorages()).rejects.toBe(networkError);
  });
});

