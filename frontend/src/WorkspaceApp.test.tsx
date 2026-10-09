import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api/client";
import WorkspaceApp from "./WorkspaceApp";
import { readDefaultCloudLocation, saveDefaultCloudLocation } from "./features/files/defaultCloudLocation";
import { useRenameStore } from "./stores/useRenameStore";
import type { AuthorizationStatus } from "./types";

vi.mock("./api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api/client")>();
  return {
    ...original,
    fetchStorages: vi.fn(), fetchRules: vi.fn(),
    fetchStorageAuthStatus: vi.fn(), fetchStorageFiles: vi.fn(), createStoragePreview: vi.fn(), executePreview: vi.fn(), fetchRenameProgress: vi.fn(),
  };
});

let client: QueryClient;
const status = (accountId: string | null, connected = true): AuthorizationStatus => ({
  configured: true, connected, account_id: accountId,
  account_display_name: "同名用户", account_email: null,
});

beforeEach(() => {
  window.localStorage.clear();
  useRenameStore.setState({ selectedIds: [], rules: [], task: null });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { x: 0, y: 0, top: 0, left: 0, bottom: 30, right: 1000,
      width: this.tagName === "BUTTON" ? 80 : 1000, height: 30, toJSON: () => ({}) };
  });
  vi.mocked(api.fetchStorages).mockResolvedValue([
    { storage_id: "default-local", provider_type: "local", name: "本地文件", revision: 1, busy: false, config: { root_path: "C:\\files" }, account_id: null, account_display_name: null, account_email: null },
    { storage_id: "user-onedrive", provider_type: "onedrive", name: "OneDrive", revision: 1, busy: false, config: { client_id: "app" }, account_id: "account-a", account_display_name: null, account_email: null },
  ]);
  vi.mocked(api.fetchRules).mockResolvedValue([]);
  vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue(status("account-a"));
  vi.mocked(api.fetchStorageFiles).mockImplementation(async (provider, location) => ({
    provider, location, path: location.kind === "root" ? "" : location.value, parent_path: location.kind === "root" ? null : "", items: [],
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function openCloud() {
  render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "OneDrive" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "设为默认路径" })).toBeEnabled());
}

describe("directory refresh selection", () => {
  it("does not display a previous connection's late directory response", async () => {
    let resolveOld: (value: Awaited<ReturnType<typeof api.fetchStorageFiles>>) => void = () => {};
    vi.mocked(api.fetchStorageFiles).mockImplementation((id) => id === "default-local" ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve({ provider: "onedrive", path: "", parent_path: null, location: { kind: "root" }, items: [] }));
    render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("default-local", { kind: "root" }));
    fireEvent.click(screen.getByRole("button", { name: "OneDrive" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "root" }));
    resolveOld({ provider: "local", path: "", parent_path: null, items: [{ id: "old", name: "old-connection.txt", path: "old-connection.txt", parent_path: "", is_directory: false, size: 1, modified_at: null }] });
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

  it("drops removed selections, invalidates the old preview and submits only remaining IDs", async () => {
    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(["A", "B", "C"]));
    vi.mocked(api.createStoragePreview).mockImplementation(async (_provider, _path, ids) => ({
      preview_id: `preview-${ids.join("-")}`, expires_at: "2099-01-01T00:00:00Z", valid: true,
      items: ids.map((id) => ({
        file_id: id, original_name: `${id}.txt`, new_name: `new-${id}.txt`,
        changed: true, valid: true, conflict: false, error: null,
      })),
    }));
    render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前显示的全部项目" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());

    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(["B", "C", "D"]));
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(useRenameStore.getState().selectedIds).toEqual(["B", "C"]));
    expect(screen.getByRole("button", { name: "开始修改" })).toBeDisabled();
    expect(screen.queryByText("new-A.txt")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith("default-local", { kind: "root" }, ["B", "C"], []));

    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing([]));
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(useRenameStore.getState().selectedIds).toEqual([]));
    expect(screen.getByRole("button", { name: "刷新预览" })).toBeDisabled();
  });

  it("preserves selection when the directory refresh fails", async () => {
    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(["A", "B", "C"]));
    render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前显示的全部项目" }));
    vi.mocked(api.fetchStorageFiles).mockRejectedValueOnce(new Error("Refresh unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByText(/目录刷新失败/);
    expect(useRenameStore.getState().selectedIds).toEqual(["A", "B", "C"]);
  });

  it("clears hidden selections and does not restore them after refresh or removing the filter", async () => {
    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(["A", "B"]));
    render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
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

describe("inline rule menu integration", () => {
  it("adds a rule without leaving the workspace", async () => {
    vi.mocked(api.fetchRules).mockResolvedValue([
      { type: "padding", name: "填充", description: "填充文件名", config_schema: {} },
    ]);
    render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "添加规则" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "添加规则" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "填充" }));
    expect(useRenameStore.getState().rules).toEqual([
      expect.objectContaining({ type: "padding", enabled: true }),
    ]);
    expect(screen.getByRole("navigation", { name: "文件路径" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "文件路径" })).getByRole("button", { name: "本地文件" })).toBeInTheDocument();
    expect(document.getElementById("location-title")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "本地根文件夹路径" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "使用此文件夹" })).not.toBeInTheDocument();
    expect(screen.getByText("1. 填充")).toBeInTheDocument();
    expect(screen.queryByText("返回工作台")).not.toBeInTheDocument();
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
    saveDefaultCloudLocation("user-onedrive", "account-a", { kind: "path", value: "照片" });
    await openCloud();
    expect(screen.getByRole("button", { name: "照片" })).toHaveAttribute("aria-current", "page");
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "path", value: "照片" });
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", { kind: "root" });
    expect(screen.queryByRole("textbox", { name: "云端文件夹路径" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开文件夹" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设为默认路径" }));
    expect(readDefaultCloudLocation("user-onedrive", "account-a")).toEqual({ kind: "path", value: "照片" });
    expect(await screen.findByText("已将“照片”设为当前账号的默认路径。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "文档" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "id", value: "document-id" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "设为默认路径" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "设为默认路径" }));
    expect(readDefaultCloudLocation("user-onedrive", "account-a")).toEqual({ kind: "id", value: "document-id" });
    fireEvent.click(screen.getByRole("button", { name: "本地文件" }));
    fireEvent.click(screen.getByRole("button", { name: "OneDrive" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenLastCalledWith("user-onedrive", { kind: "id", value: "document-id" }));
  });

  it("switches accounts without reusing the previous directory or selection", async () => {
    saveDefaultCloudLocation("user-onedrive", "account-a", { kind: "path", value: "a-folder" });
    saveDefaultCloudLocation("user-onedrive", "account-b", { kind: "path", value: "b-folder" });
    await openCloud();
    useRenameStore.setState({ selectedIds: ["old-file"] });
    vi.mocked(api.fetchStorageFiles).mockClear();
    client.setQueryData(["storage-auth", "user-onedrive", 1], status("account-b"));
    await screen.findByRole("button", { name: "b-folder" });
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "path", value: "b-folder" }));
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", { kind: "path", value: "a-folder" });
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    client.setQueryData(["storage-auth", "user-onedrive", 1], status(null, false));
    await waitFor(() => expect(screen.queryByRole("button", { name: "b-folder" })).not.toBeInTheDocument());
    expect(readDefaultCloudLocation("user-onedrive", "account-a")).toEqual({ kind: "path", value: "a-folder" });
    client.setQueryData(["storage-auth", "user-onedrive", 1], status("account-a"));
    await screen.findByRole("button", { name: "a-folder" });
  });

  it("keeps browsing available without an account ID but does not save a shared default", async () => {
    vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue(status(null));
    render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "OneDrive" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "root" }));
    expect(within(screen.getByRole("navigation", { name: "文件路径" })).getByRole("button", { name: "OneDrive" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "设为默认路径" })).toBeDisabled();
    expect(screen.getByText(/当前账号缺少账号 ID/)).toBeInTheDocument();
  });

  it("reports storage failure without replacing the saved default", async () => {
    saveDefaultCloudLocation("user-onedrive", "account-a", { kind: "path", value: "照片" });
    await openCloud();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    fireEvent.click(screen.getByRole("button", { name: "设为默认路径" }));
    expect(await screen.findByText(/默认路径保存失败/)).toBeInTheDocument();
    expect(readDefaultCloudLocation("user-onedrive", "account-a")).toEqual({ kind: "path", value: "照片" });
  });

  it("falls back to root when the default cannot be read", async () => {
    const getItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (key.startsWith("renamer-default-cloud-location:")) throw new Error("Storage unavailable");
      return getItem.call(this, key);
    });
    await openCloud();
    expect(within(screen.getByRole("navigation", { name: "文件路径" })).getByRole("button", { name: "OneDrive" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText(/无法读取默认路径/)).toBeInTheDocument();
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "root" });
  });

  it("does not overwrite the default when the requested directory fails to load", async () => {
    saveDefaultCloudLocation("user-onedrive", "account-a", { kind: "path", value: "照片" });
    await openCloud();
    vi.mocked(api.fetchStorageFiles).mockRejectedValueOnce(new Error("Directory not found"));
    fireEvent.click(within(screen.getByRole("navigation", { name: "文件路径" })).getByRole("button", { name: "OneDrive" }));
    await screen.findByText(/目录读取失败/);
    expect(screen.getByRole("button", { name: "设为默认路径" })).toBeDisabled();
    expect(readDefaultCloudLocation("user-onedrive", "account-a")).toEqual({ kind: "path", value: "照片" });
  });
});


describe("session rename batches", () => {
  const files = (count: number) => Array.from({ length: count }, (_, index) => ({
    id: `old-${index}.txt`, name: `old-${index}.txt`, path: `old-${index}.txt`, parent_path: "",
    is_directory: false, size: 1, modified_at: null,
  }));
  const begin = (count: number) => {
    const entries = files(count);
    useRenameStore.getState().setSelectedIds(entries.map((file) => file.id));
    return entries;
  };
  const succeed = (fileIds: string[], previewId: string) => {
    useRenameStore.getState().applyResults({ preview_id: previewId, status: "completed", items: fileIds.map((id) => ({
      file_id: id, original_name: id, new_name: `new-${id}`, status: "renamed", error: null,
      current_file: { id: `new-${id}`, name: `new-${id}`, path: `new-${id}`, parent_path: "", is_directory: false, size: 1, modified_at: null },
    })) });
  };

  it.each([1000, 2000])("processes %i selections in batches without reselecting successes", (count) => {
    const entries = begin(count);
    const first = useRenameStore.getState().prepareBatch("context", "local", { kind: "root" }, entries);
    expect(first.fileIds).toHaveLength(1000);
    useRenameStore.getState().bindPreview(first.batchId, "first");
    const before = useRenameStore.getState().task!.items[0].before;
    succeed(first.fileIds, "first");
    expect(useRenameStore.getState().selectedIds).toHaveLength(count - 1000);
    expect(useRenameStore.getState().task!.items[0].before).toBe(before);
    expect(before.id).toBe("old-0.txt");
    expect(useRenameStore.getState().task!.items[0].currentFileId).toBe("new-old-0.txt");
    // 刷新返回重命名后的本地 ID；全选仍不能重新执行成功项。
    const refreshed = [...entries.slice(1000), ...entries.slice(0, 1000).map((file) => ({ ...file, id: `new-${file.id}` }))];
    useRenameStore.getState().setSelectedIds(refreshed.map((file) => file.id));
    expect(useRenameStore.getState().selectedIds).toHaveLength(count - 1000);
    if (count === 2000) {
      const second = useRenameStore.getState().prepareBatch("context", "local", { kind: "root" }, refreshed);
      expect(second.fileIds).toEqual(entries.slice(1000).map((file) => file.id));
      useRenameStore.getState().bindPreview(second.batchId, "second");
      succeed(second.fileIds, "second");
      expect(useRenameStore.getState().selectedIds).toEqual([]);
      expect(useRenameStore.getState().task!.items.every((item) => item.status === "completed")).toBe(true);
    }
  });

  it("keeps other batches and failures while unknown outcomes require explicit reconciliation", () => {
    const entries = begin(1002);
    const batch = useRenameStore.getState().prepareBatch("context", "cloud", { kind: "root" }, entries);
    useRenameStore.getState().bindPreview(batch.batchId, "partial");
    useRenameStore.getState().applyResults({ preview_id: "partial", status: "partial", items: batch.fileIds.map((id, index) => ({
      file_id: id, original_name: id, new_name: `new-${id}`, status: index === 0 ? "failed" : index === 1 ? "failed" : "renamed",
      error: index < 2 ? "Write failed" : null, error_code: index === 1 ? "RENAME_OUTCOME_UNKNOWN" : null,
      actual_name: index === 0 ? id : null,
    })) });
    expect(useRenameStore.getState().selectedIds).toEqual([entries[0].id, entries[1000].id, entries[1001].id]);
    useRenameStore.getState().setSelectedIds([entries[1].id]);
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    const item = useRenameStore.getState().task!.items[1];
    useRenameStore.getState().reconcileItem(item.taskItemId, entries[1], false);
    useRenameStore.getState().setSelectedIds([entries[1].id]);
    const retry = useRenameStore.getState().prepareBatch("context", "cloud", { kind: "root" }, entries);
    expect(retry.fileIds).toEqual([entries[1].id]);
    expect(useRenameStore.getState().task!.items[1000].status).toBe("pending");
    expect(useRenameStore.getState().task!.items[1].reconciliation!.completed).toBe(false);
  });

  it("locks a batch with a lost response and preserves untouched batches", () => {
    const entries = begin(2000);
    const batch = useRenameStore.getState().prepareBatch("context", "local", { kind: "root" }, entries);
    useRenameStore.getState().bindPreview(batch.batchId, "lost");
    useRenameStore.getState().markUnknown("lost");
    expect(useRenameStore.getState().task!.items.filter((item) => item.status === "unknown")).toHaveLength(1000);
    expect(useRenameStore.getState().selectedIds).toEqual(entries.slice(1000).map((file) => file.id));
  });

  it("uses copied rules and creates a new task on changed context without rewriting old snapshots", () => {
    const entries = begin(2);
    useRenameStore.getState().setRules([{ type: "insert", enabled: true, config: { text: "first" } }]);
    useRenameStore.getState().prepareBatch("old-context", "local", { kind: "root" }, entries);
    const oldTask = useRenameStore.getState().task!;
    useRenameStore.getState().setRules([{ type: "insert", enabled: true, config: { text: "second" } }]);
    useRenameStore.getState().prepareBatch("new-context", "local", { kind: "root" }, entries);
    expect(useRenameStore.getState().task!.taskId).not.toBe(oldTask.taskId);
    expect(oldTask.rules[0].config.text).toBe("first");
    expect(useRenameStore.getState().task!.batches).toHaveLength(1);
  });
});


describe("task refresh and batch hint interaction", () => {
  const entries = (count: number) => Array.from({ length: count }, (_, index) => ({
    id: `file-${index}.txt`, name: `file-${index}.txt`, path: `file-${index}.txt`, parent_path: "",
    is_directory: false, size: 1, modified_at: null,
  }));
  const setup = async (count: number) => {
    const items = entries(count);
    vi.mocked(api.fetchStorageFiles).mockResolvedValue({ provider: "local", path: "", parent_path: null, location: { kind: "root" }, items });
    vi.mocked(api.createStoragePreview).mockImplementation(async (_storage, _location, ids) => ({
      preview_id: "task-preview", expires_at: "2099-01-01T00:00:00Z", valid: true,
      items: ids.map((id) => ({ file_id: id, original_name: id, new_name: `renamed-${id}`, changed: true, valid: true, conflict: false, error: null })),
    }));
    vi.mocked(api.fetchRenameProgress).mockResolvedValue({ preview_id: "task-preview", total: count, processed: 0, phase: "renaming", error: null });
    render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前显示的全部项目" }));
    return items;
  };

  it("opens the hint only on preview click and cancels without creating a task", async () => {
    await setup(1001);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/当前任务文件项目超过1000项最大限制/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/当前任务文件项目超过1000项最大限制/)).toBeInTheDocument();
    expect(api.createStoragePreview).not.toHaveBeenCalled();
    expect(useRenameStore.getState().task).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useRenameStore.getState().selectedIds).toHaveLength(1001);
    expect(api.createStoragePreview).not.toHaveBeenCalled();
  });

  it("remembers the hint preference and submits only 1000 after continuing", async () => {
    const items = await setup(1001);
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "下次不再提示" }));
    expect(window.localStorage.getItem("renamer-hide-batch-limit-hint")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "继续预览" }));
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledWith("default-local", { kind: "root" }, items.slice(0, 1000).map((file) => file.id), []));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["success", "lost-response"])("does not refresh automatically after %s, but allows manual refresh", async (outcome) => {
    const items = await setup(2);
    if (outcome === "success") {
      vi.mocked(api.executePreview).mockResolvedValue({ preview_id: "task-preview", status: "completed", items: items.map((file) => ({
        file_id: file.id, original_name: file.name, new_name: `renamed-${file.name}`, status: "renamed", error: null,
        current_file: { ...file, id: `renamed-${file.id}`, name: `renamed-${file.name}`, path: `renamed-${file.path}` },
      })) });
    } else {
      vi.mocked(api.executePreview).mockRejectedValue(new Error("Execution response lost"));
    }
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    // 活跃任务的目录缓存即使被其他组件标记失效，也不得自动读取目录。
    await act(async () => { await client.invalidateQueries({ queryKey: ["files"] }); });
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "开始修改" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(useRenameStore.getState().task!.items.every((item) => item.status === (outcome === "success" ? "completed" : "unknown"))).toBe(true));
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    if (outcome === "success") {
      const cached = client.getQueryData<{ items: { id: string }[] }>(["files", "default-local", 1, { kind: "root" }]);
      expect(cached!.items.map((file) => file.id)).toEqual(items.map((file) => `renamed-${file.id}`));
      vi.mocked(api.fetchStorageFiles).mockResolvedValue({ provider: "local", path: "", parent_path: null, items: items.map((file) => ({
        ...file, id: `renamed-${file.id}`, name: `renamed-${file.name}`, path: `renamed-${file.path}`,
      })) });
    } else {
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledTimes(2));
  });
});
