import { createElement, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "../../api/client";
import { useRenameStore } from "../../stores/useRenameStore";
import { client, listing, notify, openCloud, preview, serverSettings, setupWorkspace, status } from "../../test/workspaceHarness";
import type { DirectoryListing, StorageInfo, StorageProviderDefinition } from "../../types";
import { useWorkspaceStorage } from "./useWorkspaceStorage";
import { readWorkspaceSession, workspaceSessionKey } from "../workspaceSession";

// 在测试入口注册，确保 API 导入和共享 Hook 使用同一份 mock。
vi.mock("../../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  fetchStorages: vi.fn(), fetchStorageProviders: vi.fn(), fetchStorageAuthStatus: vi.fn(), fetchStorageFiles: vi.fn(),
  pickStorageFolder: vi.fn(), fetchAppSettings: vi.fn(), patchAppSettings: vi.fn(),
  createStoragePreview: vi.fn(), releaseStoragePreview: vi.fn(), executePreview: vi.fn(),
}));

describe("workspace provider capabilities", () => {
  it.each(["pending", "failed", "missing"] as const)("blocks auth and files while provider metadata is %s, then restores the remembered directory", async (state) => {
    const definitions = await api.fetchStorageProviders();
    let finish!: (value: StorageProviderDefinition[]) => void;
    if (state === "pending") vi.mocked(api.fetchStorageProviders).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    else if (state === "failed") vi.mocked(api.fetchStorageProviders).mockRejectedValueOnce(new Error("Metadata unavailable"));
    else vi.mocked(api.fetchStorageProviders).mockResolvedValueOnce([]);
    window.sessionStorage.setItem(workspaceSessionKey, JSON.stringify({
      version: 1, activeStorageId: "user-onedrive", locations: { "user-onedrive": {
        revision: 1, accountId: "account-a", location: { kind: "id", value: "remembered-directory" },
      } },
    }));
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.providers.isSuccess).toBe(true));
    if (state !== "pending") await waitFor(() => expect(hook.result.current.providerDefinitions.isPending).toBe(false));
    expect(hook.result.current.locationReady).toBe(false);
    act(() => hook.result.current.refreshFiles());
    expect(api.fetchStorageAuthStatus).not.toHaveBeenCalled();
    expect(api.fetchStorageFiles).not.toHaveBeenCalled();
    expect(readWorkspaceSession().session.locations["user-onedrive"].location)
      .toEqual({ kind: "id", value: "remembered-directory" });
    if (state === "pending") await act(async () => { finish(definitions); });
    else await act(async () => { await client.invalidateQueries({ queryKey: ["storage-providers"] }); });
    await waitFor(() => expect(hook.result.current.cloudConnected).toBe(true));
    await waitFor(() => expect(hook.result.current.appSettingsReady).toBe(true));
    act(() => hook.result.current.restoreDefaultCloudPath());
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "id", value: "remembered-directory" });
  });

  it("restores ID locations for a non-local provider without browser auth, and blocks unsupported path requests", async () => {
    const definitions = await api.fetchStorageProviders();
    vi.mocked(api.fetchStorageProviders).mockResolvedValue([{
      ...definitions[0], provider_type: "fixture_direct", local_picker: false, locations: ["root", "id"],
    }]);
    const storages = await api.fetchStorages();
    vi.mocked(api.fetchStorages).mockResolvedValue([{
      ...storages[0], storage_id: "direct", provider_type: "fixture_direct", revision: 7,
    }]);
    window.sessionStorage.setItem(workspaceSessionKey, JSON.stringify({
      version: 1, activeStorageId: "direct", locations: { direct: {
        revision: 7, accountId: null, location: { kind: "id", value: "remembered-id" },
      } },
    }));
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    expect(hook.result.current.requiresAuth).toBe(false);
    expect(hook.result.current.supportsLocalPicker).toBe(false);
    expect(api.fetchStorageAuthStatus).not.toHaveBeenCalled();
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("direct", { kind: "id", value: "remembered-id" });
    act(() => hook.result.current.setPath("unsupported-path"));
    expect(hook.result.current.locationReady).toBe(false);
    act(() => hook.result.current.refreshFiles());
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.setLocation({ kind: "id", value: "next-id" }));
    await waitFor(() => expect(readWorkspaceSession().session.locations.direct.location)
      .toEqual({ kind: "id", value: "next-id" }));
    hook.unmount();
    client.clear();
    const remounted = mountStorage();
    await waitFor(() => expect(remounted.result.current.files.isSuccess).toBe(true));
    expect(api.fetchStorageFiles).toHaveBeenLastCalledWith("direct", { kind: "id", value: "next-id" });
    expect(api.patchAppSettings).not.toHaveBeenCalled();
  });

  it("requires auth for an unfamiliar provider and ignores a default location kind it does not support", async () => {
    const definitions = await api.fetchStorageProviders();
    vi.mocked(api.fetchStorageProviders).mockResolvedValue([{
      ...definitions[1], provider_type: "fixture_oauth", locations: ["root", "id"],
    }]);
    const storages = await api.fetchStorages();
    vi.mocked(api.fetchStorages).mockResolvedValue([{
      ...storages[1], storage_id: "oauth", provider_type: "fixture_oauth",
    }]);
    window.sessionStorage.setItem(workspaceSessionKey, JSON.stringify({ version: 1, activeStorageId: "oauth", locations: {} }));
    serverSettings.preferences.cloud_default_locations.oauth = {
      account_id: "account-a", location: { kind: "path", value: "unsupported-default" },
    };
    vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue({ ...status("account-a"), connected: false });
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.cloudStatus.isSuccess).toBe(true));
    expect(hook.result.current.requiresAuth).toBe(true);
    expect(hook.result.current.locationReady).toBe(false);
    expect(api.fetchStorageFiles).not.toHaveBeenCalled();
    act(() => client.setQueryData(["storage-auth", "oauth", 1], status("account-a")));
    await waitFor(() => expect(hook.result.current.cloudConnected).toBe(true));
    await waitFor(() => expect(hook.result.current.appSettingsReady).toBe(true));
    act(() => hook.result.current.restoreDefaultCloudPath());
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("oauth", { kind: "root" });
  });

  it("pauses on a metadata refresh failure without losing the known account, task or selection", async () => {
    const hook = await setupWorkspace(1);
    await openCloud(hook);
    act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt"]));
    await preview(hook);
    const task = useRenameStore.getState().task;
    const selected = useRenameStore.getState().selectedIds;
    const cloudSession = hook.result.current.storage.cloudSession;
    const definitions = hook.result.current.storage.providerDefinitions.data!;
    vi.mocked(api.fetchStorageProviders).mockRejectedValueOnce(new Error("Metadata refresh failed"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["storage-providers"] }); });
    await waitFor(() => expect(hook.result.current.storage.providerDefinitions.isError).toBe(true));
    expect(hook.result.current.storage.locationReady).toBe(false);
    expect(hook.result.current.storage.cloudSession).toBe(cloudSession);
    expect(useRenameStore.getState().task).toBe(task);
    expect(useRenameStore.getState().selectedIds).toEqual(selected);
    vi.mocked(api.fetchStorageProviders).mockResolvedValue(definitions);
    await act(async () => { await client.invalidateQueries({ queryKey: ["storage-providers"] }); });
    await waitFor(() => expect(hook.result.current.storage.locationReady).toBe(true));
    expect(useRenameStore.getState().task).toBe(task);
  });
});

describe("workspace storage", () => {

  it("keeps pending navigation and then the task, selection and preview when clicking the current connection", async () => {
    const hook = await setupWorkspace(1);
    let resolveDirectory!: (value: DirectoryListing) => void;
    vi.mocked(api.fetchStorageFiles).mockImplementationOnce(() => new Promise((resolve) => { resolveDirectory = resolve; }));
    act(() => hook.result.current.storage.setPath("任务目录"));
    await waitFor(() => expect(hook.result.current.storage.files.isFetching).toBe(true));
    act(() => hook.result.current.storage.selectStorage("default-local"));
    expect(hook.result.current.storage.location).toEqual({ kind: "path", value: "任务目录" });
    await act(async () => { resolveDirectory({ ...listing(1), location: { kind: "path", value: "任务目录" } }); });
    await waitFor(() => expect(readWorkspaceSession().session.locations["default-local"].location)
      .toEqual({ kind: "path", value: "任务目录" }));
    act(() => hook.result.current.workflow.selectAllFiles(["file-0.txt"]));
    await preview(hook);
    const previousTask = useRenameStore.getState().task;
    const previousPreview = hook.result.current.workflow.previewData;
    act(() => hook.result.current.storage.selectStorage("default-local"));
    expect(hook.result.current.storage.location).toEqual({ kind: "path", value: "任务目录" });
    expect(useRenameStore.getState().task).toBe(previousTask);
    expect(useRenameStore.getState().selectedIds).toEqual(["file-0.txt"]);
    expect(hook.result.current.workflow.previewData).toBe(previousPreview);
    expect(api.releaseStoragePreview).not.toHaveBeenCalled();
  });

  it.each([false, true])("preserves or resets the task when the folder picker returns selected=%s", async (selected) => {
    const hook = await setupWorkspace(1);
    await preview(hook);
    const previousTask = useRenameStore.getState().task;
    vi.mocked(api.pickStorageFolder).mockResolvedValue({ root_path: selected ? "C:\\new-root" : "C:\\files", selected });
    if (selected) {
      const storages = client.getQueryData<StorageInfo[]>(["storages"])!;
      vi.mocked(api.fetchStorages).mockResolvedValue(storages.map((storage) => storage.storage_id === "default-local"
        ? { ...storage, revision: 2, config: { root_path: "C:\\new-root" } } : storage));
      vi.mocked(api.fetchStorageFiles).mockResolvedValue({ ...listing(), items: [listing().items[1]] });
    }
    await act(async () => { await hook.result.current.storage.pickLocalRoot.mutateAsync(); });
    expect(api.pickStorageFolder).toHaveBeenCalledWith("default-local");
    if (selected) {
      await waitFor(() => expect(hook.result.current.storage.files.data?.items[0]?.id).toBe("file-1.txt"));
      expect(useRenameStore.getState().task).toBeNull();
      expect(useRenameStore.getState().selectedIds).toEqual([]);
      expect(hook.result.current.workflow.previewData).toBeUndefined();
      expect(notify).toHaveBeenCalledWith({ key: "files:notifications.rootSelected" });
    } else {
      expect(useRenameStore.getState().task).toBe(previousTask);
      expect(useRenameStore.getState().selectedIds).toEqual(["file-0.txt"]);
      expect(hook.result.current.workflow.previewData).toBeDefined();
      expect(notify).not.toHaveBeenCalled();
      expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    }
  });

  it("browses without an account ID but never saves a shared default", async () => {
    const hook = await setupWorkspace();
    vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue(status(null));
    await openCloud(hook);
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "root" });
    act(() => hook.result.current.storage.setDefaultCloudPath());
    expect(api.patchAppSettings).not.toHaveBeenCalled();
  });

  it("reports a failed save without replacing the previous default", async () => {
    const hook = await setupWorkspace();
    serverSettings.preferences.cloud_default_locations["user-onedrive"] = {
      account_id: "account-a", location: { kind: "path", value: "照片" },
    };
    await openCloud(hook);
    act(() => hook.result.current.storage.setLocation({ kind: "root" }));
    await waitFor(() => expect(hook.result.current.storage.files.data?.location).toEqual({ kind: "root" }));
    await waitFor(() => expect(hook.result.current.storage.files.isFetching).toBe(false));
    vi.mocked(api.patchAppSettings).mockRejectedValueOnce(new Error("Disk unavailable"));
    act(() => hook.result.current.storage.setDefaultCloudPath());
    await waitFor(() => expect(notify).toHaveBeenCalledWith({ key: "files:notifications.defaultSaveFailed", error: expect.objectContaining({ message: "Disk unavailable" }) }, "error"));
    expect(serverSettings.preferences.cloud_default_locations["user-onedrive"].location).toEqual({ kind: "path", value: "照片" });
    expect(client.getQueryData<typeof serverSettings>(["app-settings"])!.preferences.cloud_default_locations["user-onedrive"].location)
      .toEqual({ kind: "path", value: "照片" });
  });

  it("falls back to root when settings cannot be read", async () => {
    const hook = await setupWorkspace();
    vi.mocked(api.fetchAppSettings).mockRejectedValueOnce(new Error("Server unavailable"));
    await act(async () => { await client.resetQueries({ queryKey: ["app-settings"] }); });
    await waitFor(() => expect(hook.result.current.storage.appSettingsReady).toBe(true));
    await openCloud(hook);
    expect(hook.result.current.storage.location).toEqual({ kind: "root" });
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "root" });
    expect(notify).toHaveBeenCalledWith({ key: "files:notifications.defaultUnavailable" }, "warning");
  });

  it("does not save a default from a failed directory request", async () => {
    const hook = await setupWorkspace();
    serverSettings.preferences.cloud_default_locations["user-onedrive"] = {
      account_id: "account-a", location: { kind: "path", value: "照片" },
    };
    await openCloud(hook);
    vi.mocked(api.fetchStorageFiles).mockRejectedValueOnce(new Error("Directory not found"));
    act(() => hook.result.current.storage.setLocation({ kind: "root" }));
    await waitFor(() => expect(hook.result.current.storage.files.error?.message).toBe("Directory not found"));
    act(() => hook.result.current.storage.setDefaultCloudPath());
    expect(api.patchAppSettings).not.toHaveBeenCalled();
    expect(serverSettings.preferences.cloud_default_locations["user-onedrive"].location).toEqual({ kind: "path", value: "照片" });
  });
});

// 单独挂载存储 Hook，以新查询缓存模拟刷新；云目录仍由调用方显式触发恢复。
function mountStorage() {
  return renderHook(() => useWorkspaceStorage({ hasTask: false, onLocalRootSelected: vi.fn() }), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children),
  });
}

describe("workspace session locations", () => {
  it("clears a deleted connection's memory and returns to the default Local connection", async () => {
    const storages = await api.fetchStorages();
    vi.mocked(api.fetchStorages).mockResolvedValue([...storages, { ...storages[0], storage_id: "second-local" }]);
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    act(() => hook.result.current.selectStorage("second-local"));
    await waitFor(() => expect(readWorkspaceSession().session.locations["second-local"]).toBeDefined());
    act(() => hook.result.current.setPath("即将删除连接的位置"));
    await waitFor(() => expect(readWorkspaceSession().session.locations["second-local"].location)
      .toEqual({ kind: "path", value: "即将删除连接的位置" }));
    vi.mocked(api.fetchStorages).mockResolvedValue(storages);
    act(() => client.setQueryData(["storages"], storages));
    await waitFor(() => expect(hook.result.current.storageId).toBe("default-local"));
    await waitFor(() => expect(hook.result.current.locationReady).toBe(true));
    expect(hook.result.current.location).toEqual({ kind: "root" });
    expect(readWorkspaceSession().session.locations["second-local"]).toBeUndefined();
    expect(readWorkspaceSession().session.activeStorageId).toBe("default-local");
  });

  it("prunes inactive connection memories after configuration changes", async () => {
    const storages = await api.fetchStorages();
    window.sessionStorage.setItem(workspaceSessionKey, JSON.stringify({
      version: 1, activeStorageId: "default-local", locations: {
        "user-onedrive": { revision: 1, accountId: "account-a", location: { kind: "id", value: "old-directory" } },
      },
    }));
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    expect(readWorkspaceSession().session.locations["user-onedrive"]).toBeDefined();
    const renamed = storages.map((storage) => storage.storage_id === "user-onedrive" ? { ...storage, name: "新显示名称" } : storage);
    vi.mocked(api.fetchStorages).mockResolvedValue(renamed);
    act(() => client.setQueryData(["storages"], renamed));
    expect(readWorkspaceSession().session.locations["user-onedrive"]).toBeDefined();
    const changed = storages.map((storage) => storage.storage_id === "user-onedrive" ? { ...storage, revision: 2 } : storage);
    vi.mocked(api.fetchStorages).mockResolvedValue(changed);
    act(() => client.setQueryData(["storages"], changed));
    await waitFor(() => expect(readWorkspaceSession().session.locations["user-onedrive"]).toBeUndefined());
    expect(hook.result.current.storageId).toBe("default-local");
  });

  it("clears cloud memory on disconnect before re-entering the same account", async () => {
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    act(() => hook.result.current.selectStorage("user-onedrive"));
    await waitFor(() => expect(hook.result.current.cloudConnected).toBe(true));
    act(() => hook.result.current.restoreDefaultCloudPath());
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    act(() => hook.result.current.setPath("断开前的目录"));
    await waitFor(() => expect(readWorkspaceSession().session.locations["user-onedrive"].location)
      .toEqual({ kind: "path", value: "断开前的目录" }));
    act(() => client.setQueryData(["storage-auth", "user-onedrive", 1], { ...status(null), connected: false }));
    await waitFor(() => expect(readWorkspaceSession().session.locations["user-onedrive"]).toBeUndefined());
    expect(hook.result.current.locationReady).toBe(false);
    act(() => hook.result.current.restoreDefaultCloudPath());
    act(() => client.setQueryData(["storage-auth", "user-onedrive", 1], status("account-a")));
    await waitFor(() => expect(hook.result.current.cloudConnected).toBe(true));
    act(() => hook.result.current.restoreDefaultCloudPath());
    await waitFor(() => expect(hook.result.current.locationReady).toBe(true));
    expect(hook.result.current.location).toEqual({ kind: "root" });
  });

  it.each(["connection", "revision"] as const)("does not remember a late directory response after changing the %s", async (change) => {
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    let resolveDirectory!: (value: DirectoryListing) => void;
    vi.mocked(api.fetchStorageFiles).mockImplementationOnce(() => new Promise((resolve) => { resolveDirectory = resolve; }));
    act(() => hook.result.current.setPath("迟到目录"));
    await waitFor(() => expect(hook.result.current.files.isFetching).toBe(true));
    if (change === "connection") {
      act(() => hook.result.current.selectStorage("user-onedrive"));
      await waitFor(() => expect(hook.result.current.cloudConnected).toBe(true));
      act(() => hook.result.current.restoreDefaultCloudPath());
      await waitFor(() => expect(readWorkspaceSession().session.locations["user-onedrive"]).toBeDefined());
    } else {
      const changed = client.getQueryData<StorageInfo[]>(["storages"])!.map((storage) =>
        storage.storage_id === "default-local" ? { ...storage, revision: 2, config: { root_path: "C:\\new-root" } } : storage);
      vi.mocked(api.fetchStorages).mockResolvedValue(changed);
      act(() => client.setQueryData(["storages"], changed));
      await waitFor(() => expect(readWorkspaceSession().session.locations["default-local"].revision).toBe(2));
    }
    await act(async () => { resolveDirectory({ ...listing(), location: { kind: "path", value: "迟到目录" } }); });
    await waitFor(() => expect(client.getQueryData(["files", "default-local", 1, { kind: "path", value: "迟到目录" }])).toBeDefined());
    expect(readWorkspaceSession().session.locations["default-local"])
      .toEqual({ revision: change === "connection" ? 1 : 2, accountId: null, location: { kind: "root" } });
    const activeId = change === "connection" ? "user-onedrive" : "default-local";
    expect(readWorkspaceSession().session.activeStorageId).toBe(activeId);
    expect(hook.result.current.storageId).toBe(activeId);
    expect(hook.result.current.files.data?.provider).toBe(activeId);
    if (change === "connection") expect(readWorkspaceSession().session.locations[activeId].location).toEqual({ kind: "root" });
    expect(hook.result.current.location).toEqual({ kind: "root" });
  });

  it("keeps independent locations for multiple local connections", async () => {
    const storages = await api.fetchStorages();
    vi.mocked(api.fetchStorages).mockResolvedValue([...storages, {
      ...storages[0], storage_id: "second-local", name: "另一本地连接",
    }]);
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    act(() => hook.result.current.setPath("照片/一"));
    await waitFor(() => expect(readWorkspaceSession().session.locations["default-local"].location)
      .toEqual({ kind: "path", value: "照片/一" }));
    act(() => hook.result.current.selectStorage("second-local"));
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    act(() => hook.result.current.setPath("文档/二"));
    await waitFor(() => expect(readWorkspaceSession().session.locations["second-local"].location)
      .toEqual({ kind: "path", value: "文档/二" }));
    act(() => hook.result.current.selectStorage("default-local"));
    await waitFor(() => expect(hook.result.current.location).toEqual({ kind: "path", value: "照片/一" }));
    act(() => hook.result.current.selectStorage("second-local"));
    await waitFor(() => expect(hook.result.current.location).toEqual({ kind: "path", value: "文档/二" }));
  });

  it("restores the active cloud connection and canonical location after remount without reading root or the default", async () => {
    serverSettings.preferences.cloud_default_locations["user-onedrive"] = {
      account_id: "account-a", location: { kind: "path", value: "默认目录" },
    };
    vi.mocked(api.fetchStorageFiles).mockImplementation(async (provider, location) => ({
      ...listing(), provider, location: location.kind === "path" && location.value === "工作目录"
        ? { kind: "id", value: "opaque-directory-id" } : location,
    }));
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    act(() => hook.result.current.selectStorage("user-onedrive"));
    await waitFor(() => expect(hook.result.current.cloudConnected).toBe(true));
    await waitFor(() => expect(hook.result.current.appSettingsReady).toBe(true));
    act(() => hook.result.current.restoreDefaultCloudPath());
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    act(() => hook.result.current.setPath("工作目录"));
    await waitFor(() => expect(readWorkspaceSession().session.locations["user-onedrive"].location)
      .toEqual({ kind: "id", value: "opaque-directory-id" }));
    hook.unmount();
    client.clear();
    vi.mocked(api.fetchStorageFiles).mockClear();

    const refreshed = mountStorage();
    await waitFor(() => expect(refreshed.result.current.cloudConnected).toBe(true));
    await waitFor(() => expect(refreshed.result.current.appSettingsReady).toBe(true));
    act(() => refreshed.result.current.refreshFiles());
    expect(api.fetchStorageFiles).not.toHaveBeenCalled();
    act(() => refreshed.result.current.restoreDefaultCloudPath());
    await waitFor(() => expect(refreshed.result.current.files.isSuccess).toBe(true));
    expect(refreshed.result.current.storageId).toBe("user-onedrive");
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "id", value: "opaque-directory-id" });
    expect(api.patchAppSettings).not.toHaveBeenCalled();
  });

  it("restores a local location before querying and starts at root in a fresh session", async () => {
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    act(() => hook.result.current.setPath("工作目录"));
    await waitFor(() => expect(readWorkspaceSession().session.locations["default-local"].location)
      .toEqual({ kind: "path", value: "工作目录" }));
    hook.unmount();
    client.clear();
    vi.mocked(api.fetchStorageFiles).mockClear();
    const refreshed = mountStorage();
    await waitFor(() => expect(refreshed.result.current.files.isSuccess).toBe(true));
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("default-local", { kind: "path", value: "工作目录" });
    refreshed.unmount();
    client.clear();
    window.sessionStorage.clear();
    const fresh = mountStorage();
    await waitFor(() => expect(fresh.result.current.files.isSuccess).toBe(true));
    expect(fresh.result.current.location).toEqual({ kind: "root" });
  });

  it.each(["{broken", JSON.stringify({ version: 2 }), JSON.stringify({
    version: 1, activeStorageId: "default-local", locations: { "default-local": {
      revision: 1, accountId: null, location: { kind: "id", value: 42 },
    } },
  })])("ignores invalid session data: %s", async (stored) => {
    window.sessionStorage.setItem(workspaceSessionKey, stored);
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    expect(hook.result.current.storageId).toBe("default-local");
    expect(hook.result.current.location).toEqual({ kind: "root" });
  });

  it("does not reuse a location from an older connection revision", async () => {
    window.sessionStorage.setItem(workspaceSessionKey, JSON.stringify({
      version: 1, activeStorageId: "default-local", locations: { "default-local": {
        revision: 0, accountId: null, location: { kind: "path", value: "旧根目录下的位置" },
      } },
    }));
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("default-local", { kind: "root" });
  });

  it("uses the current account default instead of another account's remembered location", async () => {
    window.sessionStorage.setItem(workspaceSessionKey, JSON.stringify({
      version: 1, activeStorageId: "user-onedrive", locations: { "user-onedrive": {
        revision: 1, accountId: "account-b", location: { kind: "id", value: "other-account-directory" },
      } },
    }));
    serverSettings.preferences.cloud_default_locations["user-onedrive"] = {
      account_id: "account-a", location: { kind: "path", value: "当前账号默认目录" },
    };
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.cloudConnected).toBe(true));
    await waitFor(() => expect(hook.result.current.appSettingsReady).toBe(true));
    act(() => hook.result.current.restoreDefaultCloudPath());
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "path", value: "当前账号默认目录" });
  });

  it("keeps the last successful location when navigation fails", async () => {
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    act(() => hook.result.current.setPath("工作目录"));
    await waitFor(() => expect(readWorkspaceSession().session.locations["default-local"].location)
      .toEqual({ kind: "path", value: "工作目录" }));
    vi.mocked(api.fetchStorageFiles).mockRejectedValueOnce(new Error("Directory not found"));
    act(() => hook.result.current.setPath("不存在的目录"));
    await waitFor(() => expect(hook.result.current.files.isError).toBe(true));
    expect(readWorkspaceSession().session.locations["default-local"].location)
      .toEqual({ kind: "path", value: "工作目录" });
  });

  it("preserves in-memory locations and warns once when session storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    const hook = mountStorage();
    await waitFor(() => expect(hook.result.current.files.isSuccess).toBe(true));
    act(() => hook.result.current.setPath("内存目录"));
    await waitFor(() => expect(hook.result.current.files.data?.location).toEqual({ kind: "path", value: "内存目录" }));
    act(() => hook.result.current.selectStorage("default-local"));
    await waitFor(() => expect(hook.result.current.location).toEqual({ kind: "path", value: "内存目录" }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ key: "files:notifications.sessionUnavailable" }, "warning");
  });
});
