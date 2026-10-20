import { type ReactNode, useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, vi } from "vitest";
import * as api from "../api/client";
import { useRenameStore } from "../stores/useRenameStore";
import { useRenameWorkflow } from "../features/rename/useRenameWorkflow";
import { useWorkspaceStorage } from "../workspace/hooks/useWorkspaceStorage";
import { defaultFileSort, type FileSort } from "../features/files/fileSort";
import type { AppSettings, AuthorizationStatus, DirectoryListing } from "../types";

vi.mock("../components/NotificationProvider", async (importOriginal) => ({
  ...await importOriginal<typeof import("../components/NotificationProvider")>(),
  useNotification: () => notify,
}));

export const notify = vi.fn();
export let client: QueryClient;
export let serverSettings: AppSettings;
export const status = (accountId: string | null): AuthorizationStatus => ({
  configured: true, connected: true, account_id: accountId,
  account_display_name: "同名用户", account_email: null,
});
export const listing = (count = 2): DirectoryListing => ({
  provider: "local", path: "", parent_path: null, location: { kind: "root" },
  items: Array.from({ length: count }, (_, index) => ({
    id: `file-${index}.txt`, name: `file-${index}.txt`, path: `file-${index}.txt`,
    parent_path: "", is_directory: false, size: 1, modified_at: null,
  })),
});

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  useRenameStore.setState({ selectedIds: [], rules: [], task: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  serverSettings = { preferences: { language: "auto", theme: "system", hide_batch_limit_hint: false, cloud_default_locations: {} } };
  vi.mocked(api.fetchAppSettings).mockImplementation(async () => serverSettings);
  vi.mocked(api.patchAppSettings).mockImplementation(async (patch) => {
    const locations = { ...serverSettings.preferences.cloud_default_locations };
    for (const [id, location] of Object.entries(patch.cloud_default_locations ?? {})) {
      if (location) locations[id] = location;
      else delete locations[id];
    }
    serverSettings = { preferences: {
      ...serverSettings.preferences, ...patch,
      cloud_default_locations: locations,
    } };
    return serverSettings;
  });
  vi.mocked(api.fetchStorages).mockResolvedValue([
    { storage_id: "default-local", provider_type: "local", name: "本地文件", revision: 1, busy: false,
      config: { root_path: "C:\\files" }, account_id: null, account_display_name: null, account_email: null },
    { storage_id: "user-onedrive", provider_type: "onedrive", name: "OneDrive", revision: 1, busy: false,
      config: { client_id: "app" }, account_id: "account-a", account_display_name: null, account_email: null },
  ]);
  vi.mocked(api.fetchStorageProviders).mockResolvedValue([
    { provider_type: "local", name: "Local", locations: ["root", "path", "id"], can_rename: true,
      browser_auth: false, local_picker: true, config_schema: {}, config_fields: [], account_label: "用户", icon: "computer" },
    { provider_type: "onedrive", name: "OneDrive", locations: ["root", "path", "id"], can_rename: true,
      browser_auth: true, local_picker: false, config_schema: {}, config_fields: [], account_label: "Microsoft 用户", icon: "cloud" },
  ]);
  vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue(status("account-a"));
  vi.mocked(api.fetchStorageFiles).mockImplementation(async (provider, location) => ({
    ...listing(), provider, location, path: location.kind === "root" ? "" : location.value,
  }));
  vi.mocked(api.releaseStoragePreview).mockResolvedValue(undefined);
  vi.mocked(api.createStoragePreview).mockImplementation(async (_storage, _location, ids) => ({
    preview_id: "task-preview", expires_at: "2099-01-01T00:00:00Z", valid: true,
    items: ids.map((id) => ({ file_id: id, original_name: id, new_name: `renamed-${id}`,
      changed: true, valid: true, conflict: false, error: null })),
  }));
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });

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
