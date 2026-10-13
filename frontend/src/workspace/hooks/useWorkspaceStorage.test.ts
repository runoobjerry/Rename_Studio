import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRenameStore } from "../../stores/useRenameStore";
import { api, client, listing, notify, openCloud, preview, serverSettings, setupWorkspace, status } from "../../test/workspaceHarness";
import type { StorageInfo } from "../../types";

describe("workspace storage", () => {
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
      expect(notify).toHaveBeenCalledWith("已选择本地根文件夹。");
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
    await waitFor(() => expect(notify).toHaveBeenCalledWith("默认路径保存失败：Disk unavailable", "error"));
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
    expect(notify).toHaveBeenCalledWith("无法读取默认路径，将打开云盘根目录。", "warning");
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
