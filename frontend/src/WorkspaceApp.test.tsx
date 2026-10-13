import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api/client";
import WorkspaceApp from "./WorkspaceApp";
import { readDefaultCloudLocation } from "./features/files/defaultCloudLocation";
import { useRenameStore } from "./stores/useRenameStore";
import type { AppSettings, AuthorizationStatus, StorageInfo, StorageLocation } from "./types";

vi.mock("./api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api/client")>();
  return {
    ...original,
    fetchStorages: vi.fn(), fetchRules: vi.fn(), pickStorageFolder: vi.fn(),
    fetchStorageAuthStatus: vi.fn(), fetchStorageFiles: vi.fn(), createStoragePreview: vi.fn(), releaseStoragePreview: vi.fn(), executePreview: vi.fn(), fetchRenameProgress: vi.fn(),
    fetchAppSettings: vi.fn(), patchAppSettings: vi.fn(), factoryResetAppSettings: vi.fn(), fetchStorageProviders: vi.fn(),
  };
});

let client: QueryClient;
let serverSettings: AppSettings;
const savedCloud = (storageId: string, accountId: string) => {
  const settings = client.getQueryData<AppSettings>(["app-settings"]);
  expect(settings).toBeDefined();
  return readDefaultCloudLocation(settings!.preferences, storageId, accountId);
};
const seedCloud = (storageId: string, accountId: string, location: StorageLocation) => {
  serverSettings.preferences.cloud_default_locations[storageId] = { account_id: accountId, location };
};
const status = (accountId: string | null, connected = true): AuthorizationStatus => ({
  configured: true, connected, account_id: accountId,
  account_display_name: "同名用户", account_email: null,
});

beforeEach(() => {
  window.localStorage.clear();
  serverSettings = { preferences: {
    theme: "system", hide_batch_limit_hint: false, cloud_default_locations: {},
  } };
  vi.mocked(api.fetchAppSettings).mockImplementation(async () => serverSettings);
  vi.mocked(api.patchAppSettings).mockImplementation(async (patch) => {
    const locations = { ...serverSettings.preferences.cloud_default_locations };
    for (const [storageId, location] of Object.entries(patch.cloud_default_locations ?? {})) {
      if (location) locations[storageId] = location;
      else delete locations[storageId];
    }
    serverSettings = { preferences: {
      ...serverSettings.preferences, ...patch, cloud_default_locations: locations,
    } };
    return serverSettings;
  });
  vi.mocked(api.factoryResetAppSettings).mockImplementation(async () => {
    serverSettings = { preferences: {
      theme: "system", hide_batch_limit_hint: false, cloud_default_locations: {},
    } };
    vi.mocked(api.fetchStorages).mockResolvedValue([{
      storage_id: "default-local", provider_type: "local", name: "本地文件", revision: 2, busy: false,
      config: { root_path: "C:\\files" }, account_id: null, account_display_name: null, account_email: null,
    }]);
    return serverSettings;
  });
  vi.mocked(api.fetchStorageProviders).mockResolvedValue([
    { provider_type: "local", name: "Local", locations: ["root", "path", "id"], can_rename: true,
      browser_auth: false, local_picker: true, config_schema: {} },
    { provider_type: "onedrive", name: "OneDrive", locations: ["root", "path", "id"], can_rename: true,
      browser_auth: true, local_picker: false, config_schema: {} },
  ]);
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
  vi.mocked(api.releaseStoragePreview).mockResolvedValue(undefined);
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
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith("default-local", { kind: "root" }, ["B", "C"], [], "preview-A-B-C"));

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

  it("isolates a new connection revision and clears its previous task and preview", async () => {
    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(["A"]));
    vi.mocked(api.createStoragePreview).mockResolvedValue({
      preview_id: "revision-preview", expires_at: "2099-01-01T00:00:00Z", valid: true,
      items: [{ file_id: "A", original_name: "A.txt", new_name: "new-A.txt", changed: true, valid: true, conflict: false, error: null }],
    });
    render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
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

  it.each([false, true])("preserves or resets the task when the folder picker returns selected=%s", async (selected) => {
    vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(["A"]));
    vi.mocked(api.createStoragePreview).mockResolvedValue({
      preview_id: "picker-preview", expires_at: "2099-01-01T00:00:00Z", valid: true,
      items: [{ file_id: "A", original_name: "A.txt", new_name: "new-A.txt", changed: true, valid: true, conflict: false, error: null }],
    });
    vi.mocked(api.pickStorageFolder).mockResolvedValue({ root_path: selected ? "C:\\new-root" : "C:\\files", selected });
    render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前显示的全部项目" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    const previousTask = useRenameStore.getState().task;
    if (selected) {
      const storages = client.getQueryData<StorageInfo[]>(["storages"])!;
      vi.mocked(api.fetchStorages).mockResolvedValue(storages.map((storage) => storage.storage_id === "default-local"
        ? { ...storage, revision: 2, config: { root_path: "C:\\new-root" } } : storage));
      vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(["B"]));
    }
    fireEvent.click(screen.getByRole("button", { name: "浏览…" }));
    await waitFor(() => expect(api.pickStorageFolder).toHaveBeenCalledWith("default-local"));
    await waitFor(() => expect(screen.getByRole("button", { name: "浏览…" })).toBeEnabled());
    if (selected) {
      await screen.findByText("已选择本地根文件夹。");
      await screen.findByRole("checkbox", { name: "选择文件 B.txt" });
      expect(useRenameStore.getState().selectedIds).toEqual([]);
      expect(useRenameStore.getState().task).toBeNull();
      expect(screen.getByRole("button", { name: "开始修改" })).toBeDisabled();
    } else {
      expect(useRenameStore.getState().selectedIds).toEqual(["A"]);
      expect(useRenameStore.getState().task).toBe(previousTask);
      expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled();
      expect(screen.queryByText("已选择本地根文件夹。")).not.toBeInTheDocument();
      expect(api.fetchStorageFiles).toHaveBeenCalledTimes(1);
    }
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
    window.localStorage.setItem('renamer-default-cloud-path:["onedrive","account-a"]', "Old");
    window.localStorage.setItem('renamer-default-cloud-location:["user-onedrive","account-a"]', JSON.stringify({ kind: "id", value: "old" }));
    seedCloud("user-onedrive", "account-a", { kind: "path", value: "照片" });
    await openCloud();
    expect(screen.getByRole("button", { name: "照片" })).toHaveAttribute("aria-current", "page");
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "path", value: "照片" });
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", { kind: "root" });
    expect(screen.queryByRole("textbox", { name: "云端文件夹路径" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开文件夹" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设为默认路径" }));
    await waitFor(() => expect(savedCloud("user-onedrive", "account-a")).toEqual({ kind: "path", value: "照片" }));
    expect(await screen.findByText("已将“照片”设为当前账号的默认路径。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "文档" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "id", value: "document-id" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "设为默认路径" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "设为默认路径" }));
    await waitFor(() => expect(savedCloud("user-onedrive", "account-a")).toEqual({ kind: "id", value: "document-id" }));
    fireEvent.click(screen.getByRole("button", { name: "本地文件" }));
    fireEvent.click(screen.getByRole("button", { name: "OneDrive" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenLastCalledWith("user-onedrive", { kind: "id", value: "document-id" }));
  });

  it("switches accounts without reusing the previous directory or selection", async () => {
    seedCloud("user-onedrive", "account-a", { kind: "path", value: "a-folder" });
    await openCloud();
    useRenameStore.setState({ selectedIds: ["old-file"] });
    vi.mocked(api.fetchStorageFiles).mockClear();
    serverSettings = { preferences: { ...serverSettings.preferences, cloud_default_locations: {} } };
    client.setQueryData(["app-settings"], serverSettings);
    client.setQueryData(["storage-auth", "user-onedrive", 1], status("account-b"));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "root" }));
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", { kind: "path", value: "a-folder" });
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    await waitFor(() => expect(screen.getByRole("button", { name: "设为默认路径" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "设为默认路径" }));
    await waitFor(() => expect(serverSettings.preferences.cloud_default_locations["user-onedrive"]).toEqual({
      account_id: "account-b", location: { kind: "root" },
    }));
    expect(savedCloud("user-onedrive", "account-a")).toEqual({ kind: "root" });
    client.setQueryData(["storage-auth", "user-onedrive", 1], status("account-a"));
    await waitFor(() => expect(screen.getByRole("button", { name: "设为默认路径" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "a-folder" })).not.toBeInTheDocument();
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
    seedCloud("user-onedrive", "account-a", { kind: "path", value: "照片" });
    await openCloud();
    vi.mocked(api.patchAppSettings).mockRejectedValueOnce(new Error("Disk unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "设为默认路径" }));
    expect(await screen.findByText(/默认路径保存失败/)).toBeInTheDocument();
    expect(savedCloud("user-onedrive", "account-a")).toEqual({ kind: "path", value: "照片" });
  });

  it("falls back to root when the default cannot be read", async () => {
    vi.mocked(api.fetchAppSettings).mockRejectedValueOnce(new Error("Server unavailable"));
    await openCloud();
    expect(within(screen.getByRole("navigation", { name: "文件路径" })).getByRole("button", { name: "OneDrive" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText(/无法读取默认路径/)).toBeInTheDocument();
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "root" });
  });

  it("does not overwrite the default when the requested directory fails to load", async () => {
    seedCloud("user-onedrive", "account-a", { kind: "path", value: "照片" });
    await openCloud();
    vi.mocked(api.fetchStorageFiles).mockRejectedValueOnce(new Error("Directory not found"));
    fireEvent.click(within(screen.getByRole("navigation", { name: "文件路径" })).getByRole("button", { name: "OneDrive" }));
    await screen.findByText(/目录读取失败/);
    expect(screen.getByRole("button", { name: "设为默认路径" })).toBeDisabled();
    expect(savedCloud("user-onedrive", "account-a")).toEqual({ kind: "path", value: "照片" });
  });
});

describe("factory reset", () => {
  const openSettings = async () => {
    render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    return screen.findByRole("button", { name: "将程序还原为原始默认状态" });
  };

  it("cancels confirmation without calling the reset API", async () => {
    fireEvent.click(await openSettings());
    const dialog = screen.getByRole("dialog", { name: "确认恢复出厂设置？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(api.factoryResetAppSettings).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "确认恢复出厂设置？" })).not.toBeInTheDocument());
  });

  it("clears in-memory rules and old app keys after one successful reset", async () => {
    serverSettings.preferences.theme = "dark";
    serverSettings.preferences.hide_batch_limit_hint = true;
    seedCloud("user-onedrive", "account-a", { kind: "id", value: "old-folder" });
    window.localStorage.setItem("renamer-color-mode", "dark");
    window.localStorage.setItem('renamer-default-cloud-location:["user-onedrive","account-a"]', "old");
    window.localStorage.setItem("unrelated-data", "keep");
    useRenameStore.setState({ rules: [{ type: "insert", enabled: true, config: { text: "x" } }], selectedIds: ["old"], task: null });
    fireEvent.click(await openSettings());
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认恢复出厂设置？" }))
      .getByRole("button", { name: "恢复出厂设置" }));
    await waitFor(() => expect(api.factoryResetAppSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useRenameStore.getState().rules).toEqual([]));
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(serverSettings.preferences).toEqual({ theme: "system", hide_batch_limit_hint: false, cloud_default_locations: {} });
    expect(window.localStorage.getItem("renamer-color-mode")).toBeNull();
    expect(window.localStorage.getItem('renamer-default-cloud-location:["user-onedrive","account-a"]')).toBeNull();
    expect(window.localStorage.getItem("unrelated-data")).toBe("keep");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "确认恢复出厂设置？" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("combobox", { name: "外观主题" })).toHaveTextContent("跟随系统"));
  });

  it("keeps the cleanup warning visible after a successful reset", async () => {
    useRenameStore.setState({ rules: [{ type: "insert", enabled: true, config: { text: "x" } }] });
    fireEvent.click(await openSettings());
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => { throw new Error("Storage unavailable"); });
    window.localStorage.setItem("renamer-color-mode", "dark");
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认恢复出厂设置？" }))
      .getByRole("button", { name: "恢复出厂设置" }));
    expect(await screen.findByText(/恢复已完成，但旧浏览器设置未能清理/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "确认恢复出厂设置？" })).not.toBeInTheDocument());
    expect(screen.getByText(/恢复已完成，但旧浏览器设置未能清理/)).toBeInTheDocument();
    expect(screen.queryByText("已恢复出厂设置。")).not.toBeInTheDocument();
    expect(useRenameStore.getState().rules).toEqual([]);
    expect(serverSettings.preferences.theme).toBe("system");
  });

  it("keeps current settings and rules when reset fails", async () => {
    serverSettings.preferences.theme = "dark";
    useRenameStore.setState({ rules: [{ type: "insert", enabled: true, config: { text: "keep" } }] });
    vi.mocked(api.factoryResetAppSettings).mockRejectedValueOnce(new Error("Disk unavailable"));
    fireEvent.click(await openSettings());
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认恢复出厂设置？" }))
      .getByRole("button", { name: "恢复出厂设置" }));
    expect(await screen.findByText(/恢复出厂设置失败：Disk unavailable/)).toBeInTheDocument();
    expect(useRenameStore.getState().rules).toHaveLength(1);
    expect(serverSettings.preferences.theme).toBe("dark");
    expect(screen.getByRole("dialog", { name: "确认恢复出厂设置？" })).toBeInTheDocument();
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

  it.each(["toggle", "select-all", "clear", "invert"] as const)("invalidates an old preview after %s selection", async (operation) => {
    const items = await setup(2);
    if (operation === "select-all") {
      fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
      act(() => useRenameStore.getState().setSelectedIds([items[0].id]));
    }
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    if (operation === "toggle") {
      fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 file-0.txt" }));
    } else if (operation === "invert") {
      fireEvent.click(screen.getByRole("button", { name: "反选" }));
    } else {
      fireEvent.click(screen.getByRole("checkbox", { name: "选择当前显示的全部项目" }));
    }
    expect(useRenameStore.getState().selectedIds).toEqual(operation === "toggle" ? [items[1].id]
      : operation === "select-all" ? items.map((item) => item.id) : []);
    expect(screen.getByRole("button", { name: "开始修改" })).toBeDisabled();
    expect(screen.queryByText("renamed-file-0.txt")).not.toBeInTheDocument();
    expect(api.executePreview).not.toHaveBeenCalled();
  });

  it("preserves partial results during reconciliation and clears them on an ordinary selection", async () => {
    const items = await setup(2);
    vi.mocked(api.executePreview).mockResolvedValue({ preview_id: "task-preview", status: "partial", items: items.map((file, index) => ({
      file_id: file.id, original_name: file.name, new_name: `renamed-${file.name}`,
      status: index === 0 ? "failed" : "renamed", error: index === 0 ? "Write failed" : null,
    })) });
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "开始修改" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    // 默认待处理筛选隐藏失败/完成项，reconcileSelection 清空选择但保留执行结果。
    await waitFor(() => expect(useRenameStore.getState().selectedIds).toEqual([]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Write failed")).toBeInTheDocument();
    expect(screen.getByText("已修改")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "失败/待核对" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 file-0.txt" }));
    expect(useRenameStore.getState().selectedIds).toEqual([items[0].id]);
    expect(screen.queryByText("Write failed")).not.toBeInTheDocument();
    expect(screen.queryByText("已修改")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始修改" })).toBeDisabled();
    expect(api.executePreview).toHaveBeenCalledTimes(1);
  });

  it("keeps selection controls locked while execution is pending", async () => {
    const items = await setup(2);
    let resolveExecution!: (value: Awaited<ReturnType<typeof api.executePreview>>) => void;
    vi.mocked(api.executePreview).mockImplementationOnce(() => new Promise((resolve) => { resolveExecution = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "开始修改" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(api.executePreview).toHaveBeenCalledTimes(1));
    // Dialog 打开时背景 aria-hidden，用真实 input 验证控件禁用状态。
    const fileSelection = screen.getByLabelText("选择文件 file-0.txt");
    const allSelection = screen.getByLabelText("选择当前显示的全部项目");
    const invertSelection = screen.getByLabelText("反选", { selector: "button" });
    expect(fileSelection).toBeDisabled();
    expect(allSelection).toBeDisabled();
    expect(invertSelection).toBeDisabled();
    fireEvent.click(fileSelection);
    fireEvent.click(allSelection);
    fireEvent.click(invertSelection);
    expect(useRenameStore.getState().selectedIds).toEqual(items.map((item) => item.id));
    await act(async () => resolveExecution({ preview_id: "task-preview", status: "completed", items: items.map((file) => ({
      file_id: file.id, original_name: file.name, new_name: `renamed-${file.name}`, status: "renamed", error: null,
    })) }));
  });

  it("opens the hint only on preview click and cancels without creating a task", async () => {
    window.localStorage.setItem("renamer-hide-batch-limit-hint", "true");
    await setup(1001);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/超过\s*1000\s*项的上限/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/超过\s*1000\s*项的上限/)).toBeInTheDocument();
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
    await waitFor(() => expect(serverSettings.preferences.hide_batch_limit_hint).toBe(true));
    expect(window.localStorage.getItem("renamer-hide-batch-limit-hint")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "继续预览" }));
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledWith("default-local", { kind: "root" }, items.slice(0, 1000).map((file) => file.id), []));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retains the release ID after selection resets the preview and releases it on task end", async () => {
    await setup(2);
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 file-0.txt" }));
    expect(screen.getByRole("button", { name: "开始修改" })).toBeDisabled();
    expect(api.releaseStoragePreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "结束当前任务" }));
    await waitFor(() => expect(api.releaseStoragePreview).toHaveBeenCalledWith("default-local", "task-preview"));
    expect(useRenameStore.getState().task).toBeNull();
  });

  it("releases a late preview response after its selection context changes", async () => {
    await setup(2);
    let resolvePreview!: (value: Awaited<ReturnType<typeof api.createStoragePreview>>) => void;
    vi.mocked(api.createStoragePreview).mockImplementationOnce(() => new Promise((resolve) => { resolvePreview = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledTimes(1));
    act(() => useRenameStore.getState().setSelectedIds([]));
    await act(async () => resolvePreview({ preview_id: "late-preview", expires_at: "2099-01-01T00:00:00Z", valid: true, items: [] }));
    await waitFor(() => expect(api.releaseStoragePreview).toHaveBeenCalledWith("default-local", "late-preview"));
    expect(screen.getByRole("button", { name: "开始修改" })).toBeDisabled();
  });

  it("invalidates a preview on rule changes and retains its ID for replacement", async () => {
    vi.mocked(api.fetchRules).mockResolvedValue([
      { type: "insert", name: "插入", description: "插入文本", config_schema: {} },
    ]);
    const items = await setup(2);
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "添加规则" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "插入" }));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(useRenameStore.getState().rules).toEqual([expect.objectContaining({ type: "insert", enabled: true })]);
    expect(screen.getByRole("button", { name: "开始修改" })).toBeDisabled();
    expect(api.releaseStoragePreview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenLastCalledWith(
      "default-local", { kind: "root" }, items.map((file) => file.id), useRenameStore.getState().rules, "task-preview",
    ));
    expect(api.executePreview).not.toHaveBeenCalled();
  });

  it("releases a late preview to its original storage after switching connections", async () => {
    await setup(2);
    let resolvePreview!: (value: Awaited<ReturnType<typeof api.createStoragePreview>>) => void;
    vi.mocked(api.createStoragePreview).mockImplementationOnce(() => new Promise((resolve) => { resolvePreview = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "OneDrive" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "root" }));
    await act(async () => resolvePreview({ preview_id: "late-storage-preview", expires_at: "2099-01-01T00:00:00Z", valid: true, items: [] }));
    await waitFor(() => expect(api.releaseStoragePreview).toHaveBeenCalledWith("default-local", "late-storage-preview"));
    expect(useRenameStore.getState().task).toBeNull();
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(screen.getByRole("button", { name: "开始修改" })).toBeDisabled();
    expect(api.executePreview).not.toHaveBeenCalled();
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
