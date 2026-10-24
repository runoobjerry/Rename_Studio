import { type ReactNode, useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, vi } from "vitest";
import * as api from "../api/client";
import { useRenameStore } from "../stores/useRenameStore";
import { useRenameWorkflow } from "../features/rename/useRenameWorkflow";
import { useWorkspaceStorage } from "../workspace/hooks/useWorkspaceStorage";
import { defaultFileSort, type FileSort } from "../features/files/fileSort";
import type { AppSettings } from "../types";
import { appSettings, listing, previewResponse, providerDefinitions, status, storages } from "./fixtures";

export { listing, status } from "./fixtures";
export const notify = vi.fn();
export let client: QueryClient;
export let serverSettings: AppSettings;

// 各测试入口显式启用生命周期；导入数据或 Hook 辅助函数没有注册副作用。
export function installWorkspaceTestHooks() {
  beforeEach(() => {
    // 只重置 API 边界，保留全局 setup 刚安装的语言和 Canvas 环境。
    for (const value of Object.values(api)) if (vi.isMockFunction(value)) value.mockReset();
    notify.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    useRenameStore.setState({ selectedIds: [], rules: [], task: null });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    serverSettings = appSettings();
    vi.mocked(api.fetchAppSettings).mockImplementation(async () => serverSettings);
    vi.mocked(api.patchAppSettings).mockImplementation(async (patch) => {
      const locations = { ...serverSettings.preferences.cloud_default_locations };
      for (const [id, location] of Object.entries(patch.cloud_default_locations ?? {})) {
        if (location) locations[id] = location;
        else delete locations[id];
      }
      serverSettings = { preferences: {
        ...serverSettings.preferences, ...patch, cloud_default_locations: locations,
      } };
      return serverSettings;
    });
    vi.mocked(api.fetchStorages).mockResolvedValue(storages());
    vi.mocked(api.fetchStorageProviders).mockResolvedValue(providerDefinitions());
    vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue(status("account-a"));
    vi.mocked(api.fetchStorageFiles).mockImplementation(async (provider, location) => ({
      ...listing(), provider, location, path: location.kind === "root" ? "" : location.value,
      parent_path: location.kind === "root" ? null : "",
    }));
    vi.mocked(api.releaseStoragePreview).mockResolvedValue(undefined);
    vi.mocked(api.createStoragePreview).mockImplementation(async (_storage, _location, ids) => previewResponse(ids));
    vi.mocked(api.fetchRules).mockResolvedValue([]);
    vi.mocked(api.factoryResetAppSettings).mockImplementation(async () => {
      serverSettings = appSettings();
      vi.mocked(api.fetchStorages).mockResolvedValue([{ ...storages()[0], revision: 2 }]);
      return serverSettings;
    });
  });
  afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
}

// 使用真实查询、Store 和两个 Hook；不挂载 MUI 页面，也不复制工作区的 effect。
export async function setupWorkspace(count = 2) {
  vi.mocked(api.fetchStorageFiles).mockResolvedValue(listing(count));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => {
    const [sort, setSort] = useState<FileSort>(defaultFileSort);
    const task = useRenameStore((state) => state.task);
    const storage = useWorkspaceStorage({ hasTask: Boolean(task), onLocalRootSelected: (): void => workflow.resetForStorageChange() });
    const workflow = useRenameWorkflow({ ...storage, task, sort, onSortChange: setSort });
    return { storage, workflow };
  }, { wrapper });
  await waitFor(() => expect(hook.result.current.storage.files.isSuccess).toBe(true));
  await waitFor(() => expect(client.getQueryState(["app-settings"])?.status).toBe("success"));
  act(() => hook.result.current.workflow.selectAllFiles(listing(count).items.map((file) => file.id)));
  return hook;
}

export async function openCloud(hook: Awaited<ReturnType<typeof setupWorkspace>>) {
  act(() => hook.result.current.storage.selectStorage("user-onedrive"));
  await waitFor(() => expect(hook.result.current.storage.cloudConnected).toBe(true));
  act(() => hook.result.current.storage.restoreDefaultCloudPath());
  await waitFor(() => expect(hook.result.current.storage.cloudReady).toBe(true));
  await waitFor(() => expect(hook.result.current.storage.files.isSuccess).toBe(true));
}

export async function preview(hook: Awaited<ReturnType<typeof setupWorkspace>>) {
  act(() => hook.result.current.workflow.requestPreview());
  await waitFor(() => expect(hook.result.current.workflow.previewData?.preview_id).toBe("task-preview"));
}
