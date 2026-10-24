import { deferred } from "./test/deferred";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "./api/client";
import { useRenameStore } from "./stores/useRenameStore";
import { readWorkspaceSession, workspaceSessionKey } from "./workspace/workspaceSession";
import { client, serverSettings } from "./test/workspaceHarness";
import { installWorkspaceAppTestHooks, renderWorkspace, savedCloud, seedCloud } from "./test/workspaceAppHarness";
import { status } from "./test/fixtures";
import type { StorageInfo } from "./types";

vi.mock("./api/client", async (importOriginal) => {
  const { workspaceApiMock } = await import("./test/workspaceApiMock");
  return workspaceApiMock(await importOriginal<typeof import("./api/client")>());
});
installWorkspaceAppTestHooks();

async function openCloud() {
  renderWorkspace();
  fireEvent.click(await screen.findByRole("button", { name: "OneDrive" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "设为默认" })).toBeEnabled());
}

describe("directory refresh selection", () => {
  it("does not display a previous connection's late directory response", async () => {
    const oldDirectory = deferred<Awaited<ReturnType<typeof api.fetchStorageFiles>>>();
    vi.mocked(api.fetchStorageFiles).mockImplementation((id) => id === "default-local" ? oldDirectory.promise : Promise.resolve({ provider: "onedrive", path: "", parent_path: null, location: { kind: "root" }, items: [] }));
    renderWorkspace();
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("default-local", { kind: "root" }));
    fireEvent.click(screen.getByRole("button", { name: "OneDrive" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "root" }));
    await act(async () => oldDirectory.resolve({ provider: "local", path: "", parent_path: null, items: [{ id: "old", name: "old-connection.txt", path: "old-connection.txt", parent_path: "", is_directory: false, size: 1, modified_at: null }] }));
    await waitFor(() => expect(client.getQueryData(["files", "default-local", 1, { kind: "root" }])).toBeDefined());
    expect(screen.queryByText("old-connection.txt")).not.toBeInTheDocument();
  });
  const listing = (ids: string[]) => ({
    provider: "local", path: "", parent_path: null,
    items: ids.map((id) => ({
      id, name: `${id}.txt`, path: `${id}.txt`, parent_path: "",
      is_directory: false, size: 1, modified_at: null,
    })),
  });

  it("isolates a new connection revision and clears its previous task and preview", async () => {
    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(["A"]));
    vi.mocked(api.createStoragePreview).mockResolvedValue({
      preview_id: "revision-preview", expires_at: "2099-01-01T00:00:00Z", valid: true,
      items: [{ file_id: "A", original_name: "A.txt", new_name: "new-A.txt", changed: true, valid: true, conflict: false, error: null }],
    });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前显示的全部项目" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    expect(useRenameStore.getState().task).not.toBeNull();

    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(["B"]));
    act(() => client.setQueryData<StorageInfo[]>(["storages"], (storages) => storages!.map((storage) =>
      storage.storage_id === "default-local" ? { ...storage, revision: 2 } : storage)));
    await screen.findByRole("checkbox", { name: "选择文件 B.txt" });
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(useRenameStore.getState().task).toBeNull();
    expect(screen.getByRole("button", { name: "开始修改" })).toBeDisabled();
    expect(screen.queryByText("new-A.txt")).not.toBeInTheDocument();
    expect(client.getQueryData(["files", "default-local", 1, { kind: "root" }])).toEqual(listing(["A"]));
    expect(client.getQueryData(["files", "default-local", 2, { kind: "root" }])).toEqual(listing(["B"]));
    await waitFor(() => expect(api.releaseStoragePreview).toHaveBeenCalledWith("default-local", "revision-preview"));
  });

  it("clears hidden selections and does not restore them after refresh or removing the filter", async () => {
    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(["A", "B"]));
    renderWorkspace();
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前显示的全部项目" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "文件夹" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(useRenameStore.getState().selectedIds).toEqual([]);

    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(["B"]));
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByText("目录已刷新。");
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(screen.getByRole("button", { name: "刷新预览" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "文件夹" }));
    expect(useRenameStore.getState().selectedIds).toEqual([]);
  });
});

describe("cloud default path integration", () => {
  it("restores on entry and re-entry and saves the directory opened through folder navigation", async () => {
    vi.mocked(api.fetchStorageFiles).mockImplementation(async (provider, location) => ({
      provider, location, path: location.kind === "root" ? "" : location.value === "document-id" ? "照片/文档" : location.value,
      parent_path: location.kind === "root" ? null : "", items: [{
        id: "document-id", name: "文档", path: "照片/文档", parent_path: "照片",
        location: { kind: "id", value: "document-id" }, is_directory: true, size: null, modified_at: null,
      }],
    }));
    seedCloud("user-onedrive", "account-a", { kind: "path", value: "照片" });
    await openCloud();
    expect(screen.getByRole("button", { name: "照片" })).toHaveAttribute("aria-current", "page");
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "path", value: "照片" });
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", { kind: "root" });
    expect(screen.queryByRole("textbox", { name: "云端文件夹路径" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开文件夹" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设为默认" }));
    await waitFor(() => expect(savedCloud("user-onedrive", "account-a")).toEqual({ kind: "path", value: "照片" }));
    expect(await screen.findByText("已将“照片”设为当前账号的默认路径。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "文档" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "id", value: "document-id" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "设为默认" })).toBeEnabled());
    // 默认目录仍为“照片”，重新进入须使用尚未设为默认值的工作目录。
    fireEvent.click(screen.getByRole("button", { name: "本地文件" }));
    fireEvent.click(screen.getByRole("button", { name: "OneDrive" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenLastCalledWith("user-onedrive", { kind: "id", value: "document-id" }));
    await waitFor(() => expect(within(screen.getByLabelText("文件路径")).getByRole("button", { name: "文档" }))
      .toHaveAttribute("aria-current", "page"));
    expect(savedCloud("user-onedrive", "account-a")).toEqual({ kind: "path", value: "照片" });
    await waitFor(() => expect(screen.getByRole("button", { name: "设为默认" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "设为默认" }));
    await waitFor(() => expect(savedCloud("user-onedrive", "account-a")).toEqual({ kind: "id", value: "document-id" }));
  });

  it("switches accounts without reusing the previous directory or selection", async () => {
    seedCloud("user-onedrive", "account-a", { kind: "path", value: "a-folder" });
    await openCloud();
    useRenameStore.setState({ selectedIds: ["old-file"] });
    vi.mocked(api.fetchStorageFiles).mockClear();
    serverSettings.preferences.cloud_default_locations = {};
    client.setQueryData(["app-settings"], serverSettings);
    client.setQueryData(["storage-auth", "user-onedrive", 1], status("account-b"));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "root" }));
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", { kind: "path", value: "a-folder" });
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    await waitFor(() => expect(screen.getByRole("button", { name: "设为默认" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "设为默认" }));
    await waitFor(() => expect(serverSettings.preferences.cloud_default_locations["user-onedrive"]).toEqual({
      account_id: "account-b", location: { kind: "root" },
    }));
    expect(savedCloud("user-onedrive", "account-a")).toEqual({ kind: "root" });
    expect(readWorkspaceSession().session.locations["user-onedrive"])
      .toEqual({ revision: 1, accountId: "account-b", location: { kind: "root" } });
    client.setQueryData(["storage-auth", "user-onedrive", 1], status("account-a"));
    await waitFor(() => expect(screen.getByRole("button", { name: "设为默认" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "a-folder" })).not.toBeInTheDocument();
  });

});

describe("workspace path navigation", () => {
  it("keeps the current directory through both settings return actions", async () => {
    window.sessionStorage.setItem(workspaceSessionKey, JSON.stringify({
      version: 1, activeStorageId: "default-local", locations: {
        "default-local": { revision: 1, accountId: null, location: { kind: "path", value: "工作目录" } },
      },
    }));
    renderWorkspace();
    await waitFor(() => expect(screen.getByRole("button", { name: "工作目录" })).toHaveAttribute("aria-current", "page"));
    vi.mocked(api.fetchStorageFiles).mockClear();
    for (const returnButton of ["返回主页", "本地文件"]) {
      fireEvent.click(screen.getByRole("button", { name: "设置" }));
      await screen.findByRole("button", { name: "返回主页" });
      fireEvent.click(screen.getByRole("button", { name: returnButton }));
      await waitFor(() => expect(screen.getByRole("button", { name: "工作目录" })).toHaveAttribute("aria-current", "page"));
      expect(api.fetchStorageFiles).not.toHaveBeenCalled();
      expect(readWorkspaceSession().session.locations["default-local"].location).toEqual({ kind: "path", value: "工作目录" });
    }
  });
});
