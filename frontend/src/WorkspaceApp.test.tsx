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

});

describe("factory reset", () => {
  const openSettings = async () => {
    render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    return screen.findByRole("button", { name: "将程序还原为原始默认状态" });
  };

  it("cancels confirmation without calling the reset API", async () => {
    fireEvent.click(await openSettings());
    const dialog = screen.getByRole("dialog", { name: "确认重置？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(api.factoryResetAppSettings).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "确认重置？" })).not.toBeInTheDocument());
  });

  it("clears in-memory rules and restores preferences after one successful reset", async () => {
    serverSettings.preferences.theme = "dark";
    serverSettings.preferences.hide_batch_limit_hint = true;
    seedCloud("user-onedrive", "account-a", { kind: "id", value: "old-folder" });
    useRenameStore.setState({ rules: [{ type: "insert", enabled: true, config: { text: "x" } }], selectedIds: ["old"], task: null });
    fireEvent.click(await openSettings());
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认重置？" }))
      .getByRole("button", { name: "恢复出厂设置" }));
    await waitFor(() => expect(api.factoryResetAppSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useRenameStore.getState().rules).toEqual([]));
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    expect(serverSettings.preferences).toEqual({ theme: "system", hide_batch_limit_hint: false, cloud_default_locations: {} });
    expect(await screen.findByText("已重置应用")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "确认重置？" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("combobox", { name: "外观主题" })).toHaveTextContent("跟随系统"));
  });

  it("keeps current settings and rules when reset fails", async () => {
    serverSettings.preferences.theme = "dark";
    useRenameStore.setState({ rules: [{ type: "insert", enabled: true, config: { text: "keep" } }] });
    vi.mocked(api.factoryResetAppSettings).mockRejectedValueOnce(new Error("Disk unavailable"));
    fireEvent.click(await openSettings());
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认重置？" }))
      .getByRole("button", { name: "恢复出厂设置" }));
    expect(await screen.findByText(/恢复出厂设置失败：Disk unavailable/)).toBeInTheDocument();
    expect(useRenameStore.getState().rules).toHaveLength(1);
    expect(serverSettings.preferences.theme).toBe("dark");
    expect(screen.getByRole("dialog", { name: "确认重置？" })).toBeInTheDocument();
  });
});

describe("workspace workflow wiring", () => {
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

  it("connects selection and rule changes to preview invalidation", async () => {
    vi.mocked(api.fetchRules).mockResolvedValue([
      { type: "insert", name: "插入", description: "插入文本", config_schema: {} },
    ]);
    await setup(2);
    const previewButton = screen.getByRole("button", { name: "刷新预览" });
    const executeButton = screen.getByRole("button", { name: "开始修改" });
    fireEvent.click(previewButton);
    await waitFor(() => expect(executeButton).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 file-0.txt" }));
    expect(useRenameStore.getState().selectedIds).toEqual(["file-1.txt"]);
    expect(executeButton).toBeDisabled();
    expect(screen.queryByText("renamed-file-0.txt")).not.toBeInTheDocument();
    fireEvent.click(previewButton);
    await waitFor(() => expect(executeButton).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "添加规则" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "插入" }));
    expect(useRenameStore.getState().rules).toEqual([expect.objectContaining({ type: "insert", enabled: true })]);
    expect(executeButton).toBeDisabled();
    expect(screen.queryByText("renamed-file-1.txt")).not.toBeInTheDocument();
    expect(api.executePreview).not.toHaveBeenCalled();
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

});

