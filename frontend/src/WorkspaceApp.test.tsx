import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api/client";
import WorkspaceApp from "./WorkspaceApp";
import { readDefaultCloudPath, saveDefaultCloudPath, readDefaultCloudLocation } from "./features/files/defaultCloudPath";
import { useRenameStore } from "./stores/useRenameStore";
import type { OneDriveAuthStatus } from "./types";

vi.mock("./api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api/client")>();
  return {
    ...original,
    fetchStorages: vi.fn(), fetchRules: vi.fn(), fetchLocalSettings: vi.fn(),
    fetchStorageAuthStatus: vi.fn(), fetchStorageFiles: vi.fn(), createStoragePreview: vi.fn(),
  };
});

let client: QueryClient;
const status = (accountId: string | null, connected = true): OneDriveAuthStatus => ({
  configured: true, connected, account_id: accountId,
  account_display_name: "同名用户", account_email: null,
});

beforeEach(() => {
  window.localStorage.clear();
  useRenameStore.setState({ selectedIds: [], rules: [] });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  vi.mocked(api.fetchStorages).mockResolvedValue([
    { storage_id: "default-local", provider_type: "local", name: "本地文件", enabled: true, revision: 1, busy: false, config: { root_path: "C:\\files" }, account_id: null, account_display_name: null, account_email: null },
    { storage_id: "default-onedrive", provider_type: "onedrive", name: "OneDrive", enabled: true, revision: 1, busy: false, config: { client_id: "app" }, account_id: "account-a", account_display_name: null, account_email: null },
  ]);
  vi.mocked(api.fetchRules).mockResolvedValue([]);
  vi.mocked(api.fetchLocalSettings).mockResolvedValue({ root_path: "C:\\files" });
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
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("default-onedrive", { kind: "root" }));
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
    expect(screen.getByRole("textbox", { name: "本地根文件夹路径" })).toBeInTheDocument();
    expect(screen.getByText("1. 填充")).toBeInTheDocument();
    expect(screen.queryByText("返回工作台")).not.toBeInTheDocument();
  });
});

describe("cloud default path integration", () => {
  it("restores on provider entry and re-entry, saves the opened path rather than unsent text", async () => {
    saveDefaultCloudPath("onedrive", "account-a", "照片");
    await openCloud();
    expect(screen.getByRole("textbox", { name: "云端文件夹路径" })).toHaveValue("照片");
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("default-onedrive", { kind: "path", value: "照片" });
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("default-onedrive", { kind: "root" });
    fireEvent.change(screen.getByRole("textbox", { name: "云端文件夹路径" }), { target: { value: "未打开" } });
    fireEvent.click(screen.getByRole("button", { name: "设为默认路径" }));
    expect(readDefaultCloudPath("onedrive", "account-a")).toBe("照片");
    expect(await screen.findByText("已将“照片”设为当前账号的默认路径。")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "云端文件夹路径" }), { target: { value: "文档" } });
    fireEvent.click(screen.getByRole("button", { name: "打开文件夹" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "设为默认路径" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "设为默认路径" }));
    expect(readDefaultCloudLocation("default-onedrive", "onedrive", "account-a")).toEqual({ kind: "path", value: "文档" });
    fireEvent.click(screen.getByRole("button", { name: "本地文件" }));
    fireEvent.click(screen.getByRole("button", { name: "OneDrive" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "云端文件夹路径" })).toHaveValue("文档"));
  });

  it("switches accounts without reusing the previous directory or selection", async () => {
    saveDefaultCloudPath("onedrive", "account-a", "a-folder");
    saveDefaultCloudPath("onedrive", "account-b", "b-folder");
    await openCloud();
    useRenameStore.setState({ selectedIds: ["old-file"] });
    vi.mocked(api.fetchStorageFiles).mockClear();
    client.setQueryData(["storage-auth", "default-onedrive", 1], status("account-b"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "云端文件夹路径" })).toHaveValue("b-folder"));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("default-onedrive", { kind: "path", value: "b-folder" }));
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("default-onedrive", { kind: "path", value: "a-folder" });
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    client.setQueryData(["storage-auth", "default-onedrive", 1], status(null, false));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "云端文件夹路径" })).toHaveValue(""));
    expect(readDefaultCloudPath("onedrive", "account-a")).toBe("a-folder");
    client.setQueryData(["storage-auth", "default-onedrive", 1], status("account-a"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "云端文件夹路径" })).toHaveValue("a-folder"));
  });

  it("keeps browsing available without an account ID but does not save a shared default", async () => {
    vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue(status(null));
    render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "OneDrive" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("default-onedrive", { kind: "root" }));
    expect(screen.getByRole("button", { name: "打开文件夹" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "设为默认路径" })).toBeDisabled();
    expect(screen.getByText(/当前账号缺少账号 ID/)).toBeInTheDocument();
  });

  it("reports storage failure without replacing the saved default", async () => {
    saveDefaultCloudPath("onedrive", "account-a", "照片");
    await openCloud();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    fireEvent.click(screen.getByRole("button", { name: "设为默认路径" }));
    expect(await screen.findByText(/默认路径保存失败/)).toBeInTheDocument();
    expect(readDefaultCloudPath("onedrive", "account-a")).toBe("照片");
  });

  it("falls back to root when the default cannot be read", async () => {
    const getItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (key.startsWith("renamer-default-cloud-path:")) throw new Error("Storage unavailable");
      return getItem.call(this, key);
    });
    await openCloud();
    expect(screen.getByRole("textbox", { name: "云端文件夹路径" })).toHaveValue("");
    expect(await screen.findByText(/无法读取默认路径/)).toBeInTheDocument();
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("default-onedrive", { kind: "root" });
  });

  it("does not overwrite the default when the requested directory fails to load", async () => {
    saveDefaultCloudPath("onedrive", "account-a", "照片");
    await openCloud();
    vi.mocked(api.fetchStorageFiles).mockRejectedValueOnce(new Error("Directory not found"));
    fireEvent.change(screen.getByRole("textbox", { name: "云端文件夹路径" }), { target: { value: "不存在" } });
    fireEvent.click(screen.getByRole("button", { name: "打开文件夹" }));
    await screen.findByText(/目录读取失败/);
    expect(screen.getByRole("button", { name: "设为默认路径" })).toBeDisabled();
    expect(readDefaultCloudPath("onedrive", "account-a")).toBe("照片");
  });
});
