import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/client";
import { NotificationProvider } from "../../components/NotificationProvider";
import { StorageSettingsPanel } from "./StorageSettingsPanel";

vi.mock("../../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  fetchStorageAuthStatus: vi.fn(), fetchStorages: vi.fn(), fetchStorageProviders: vi.fn(), createStorage: vi.fn(), updateStorage: vi.fn(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup(executingStorageId?: string) {
  const storage = { storage_id: "default-local", provider_type: "local", name: "Local", revision: 1, busy: false, config: { root_path: "C:\\files" }, account_id: null, account_display_name: null, account_email: null };
  vi.mocked(api.fetchStorages).mockResolvedValue([storage]);
  vi.mocked(api.fetchStorageProviders).mockResolvedValue([{ provider_type: "local", name: "Local", locations: ["root", "path"], browser_auth: false, local_picker: true, can_rename: true, config_schema: {} }]);
  vi.mocked(api.createStorage).mockResolvedValue({ ...storage, storage_id: "new-storage" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><NotificationProvider><StorageSettingsPanel executingStorageId={executingStorageId} /></NotificationProvider></QueryClientProvider>);
  return client;
}

describe("storage settings", () => {
  it("creates a separate connection with explicit configuration", async () => {
    const client = setup();
    await screen.findByRole("button", { name: "保存连接" });
    fireEvent.change(screen.getAllByRole("textbox", { name: "连接名称" })[0], { target: { value: "Other" } });
    fireEvent.change(screen.getAllByRole("textbox", { name: "本地根目录" })[0], { target: { value: "D:\\other" } });
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    await waitFor(() => expect(api.createStorage).toHaveBeenCalledWith({ provider_type: "local", name: "Other", config: { root_path: "D:\\other" } }));
    client.clear();
  });
  it("blocks edits to the executing connection and keeps defaults non-deletable", async () => {
    const client = setup("default-local");
    expect(await screen.findByRole("button", { name: "保存连接" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "选择文件夹" })).toBeDisabled();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText("已连接")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除连接" })).not.toBeInTheDocument();
    client.clear();
  });
  it("shows cloud connection status and the account name with email", async () => {
    const client = setup();
    vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue({
      configured: true, connected: true, account_id: "account-a",
      account_display_name: "测试用户", account_email: "user@example.com",
    });
    const cloud = {
      storage_id: "user-cloud", provider_type: "onedrive", name: "OneDrive", revision: 1,
      busy: false, config: { client_id: "app" }, account_id: "account-a",
      account_display_name: "测试用户", account_email: "user@example.com",
    };
    await screen.findByRole("button", { name: "保存连接" });
    client.setQueryData(["storages"], [cloud]);
    expect(await screen.findByText("测试用户(user@example.com)")).toBeInTheDocument();
    expect(screen.getByText("已连接")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除连接" })).toBeEnabled();
    client.clear();
  });

});
