import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/client";
import { NotificationProvider } from "../../components/NotificationProvider";
import { StorageSettingsPanel } from "./StorageSettingsPanel";

vi.mock("../../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  fetchStorageAuthStatus: vi.fn(), fetchStorages: vi.fn(), fetchStorageProviders: vi.fn(), createStorage: vi.fn(), updateStorage: vi.fn(), deleteStorage: vi.fn(), disconnectStorage: vi.fn(), pickStorageFolder: vi.fn(), pickLocalFolderDraft: vi.fn(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup(executingStorageId?: string) {
  const storage = { storage_id: "default-local", provider_type: "local", name: "Local", revision: 1, busy: false, config: { root_path: "C:\\files" }, account_id: null, account_display_name: null, account_email: null };
  vi.mocked(api.fetchStorages).mockResolvedValue([storage]);
  vi.mocked(api.fetchStorageProviders).mockResolvedValue([{ provider_type: "local", name: "Local", locations: ["root", "path"], browser_auth: false, local_picker: true, can_rename: true, config_schema: {} }]);
  vi.mocked(api.createStorage).mockResolvedValue({ ...storage, storage_id: "new-storage" });
  vi.mocked(api.updateStorage).mockResolvedValue(storage);
  vi.mocked(api.deleteStorage).mockResolvedValue(undefined);
  vi.mocked(api.disconnectStorage).mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><NotificationProvider><StorageSettingsPanel executingStorageId={executingStorageId} /></NotificationProvider></QueryClientProvider>);
  return { client, ...view };
}

describe("storage settings", () => {
  it("creates a separate connection with explicit configuration", async () => {
    const { client } = setup();
    await screen.findByRole("button", { name: "编辑连接 Local" });
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    fireEvent.change(screen.getByRole("textbox", { name: "连接名称" }), { target: { value: "Other" } });
    vi.mocked(api.pickLocalFolderDraft).mockResolvedValueOnce({ selected: true, root_path: "D:\\other" });
    fireEvent.click(screen.getByRole("button", { name: "浏览本地目录" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "本地根目录" })).toHaveValue("D:\\other"));
    expect(api.pickStorageFolder).not.toHaveBeenCalled();
    expect(api.updateStorage).not.toHaveBeenCalled();
    expect(api.createStorage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() => expect(api.createStorage).toHaveBeenCalledWith({ provider_type: "local", name: "Other", config: { root_path: "D:\\other" } }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    client.clear();
  });
  it("locks creation while browsing and keeps the draft when the picker is cancelled", async () => {
    const { client } = setup();
    await screen.findByRole("button", { name: "编辑连接 Local" });
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    fireEvent.change(screen.getByRole("textbox", { name: "连接名称" }), { target: { value: "Other" } });
    fireEvent.change(screen.getByRole("textbox", { name: "本地根目录" }), { target: { value: "D:\\draft" } });
    let finish!: (result: Awaited<ReturnType<typeof api.pickLocalFolderDraft>>) => void;
    vi.mocked(api.pickLocalFolderDraft).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "浏览本地目录" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "保存连接" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "浏览本地目录" })).toBeDisabled();
    finish({ selected: false, root_path: "C:\\Documents" });
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeEnabled());
    expect(screen.getByRole("textbox", { name: "本地根目录" })).toHaveValue("D:\\draft");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(api.createStorage).not.toHaveBeenCalled();
    expect(api.updateStorage).not.toHaveBeenCalled();
    client.clear();
  });
  it("blocks edits to the executing connection and keeps defaults non-deletable", async () => {
    const { client, rerender } = setup("default-local");
    expect(await screen.findByRole("button", { name: "编辑连接 Local" })).toBeDisabled();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText("已连接")).toBeInTheDocument();
    rerender(<QueryClientProvider client={client}><NotificationProvider><StorageSettingsPanel /></NotificationProvider></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "编辑连接 Local" }));
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
    client.clear();
  });
  it("shows account details only in the editor and reports successful logout", async () => {
    const { client } = setup();
    vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue({
      configured: true, connected: true, account_id: "account-a",
      account_display_name: "测试用户", account_email: "user@example.com",
    });
    const cloud = {
      storage_id: "user-cloud", provider_type: "onedrive", name: "OneDrive", revision: 1,
      busy: false, config: { client_id: "app" }, account_id: "account-a",
      account_display_name: "测试用户", account_email: "user@example.com",
    };
    await screen.findByRole("button", { name: "编辑连接 Local" });
    vi.mocked(api.fetchStorages).mockResolvedValue([cloud]);
    client.setQueryData(["storages"], [cloud]);
    // Wait for the cloud row, not the old Local row's identical status label.
    await screen.findByRole("button", { name: "编辑连接 OneDrive" });
    const table = within(screen.getByRole("table", { name: "已保存连接" }));
    await waitFor(() => expect(table.getByText("已连接")).toBeInTheDocument());
    expect(table.queryByText(/测试用户|user@example.com/)).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑连接 OneDrive" }));
    expect(screen.getByRole("button", { name: "删除" })).toBeEnabled();
    const editor = within(screen.getByRole("dialog"));
    expect(editor.getByText("测试用户")).toBeInTheDocument();
    expect(editor.getByText("user@example.com")).toBeInTheDocument();
    expect(editor.getByRole("button", { name: "退出登录" })).toBeEnabled();
    expect(editor.queryByRole("button", { name: "切换账号" })).not.toBeInTheDocument();
    fireEvent.click(editor.getByRole("button", { name: "退出登录" }));
    await waitFor(() => expect(api.disconnectStorage).toHaveBeenCalledWith("user-cloud"));
    expect(await screen.findByText("账号已退出。")).toBeInTheDocument();
    client.clear();
  });

  it("updates the local root through the inline folder picker and preserves it on cancellation", async () => {
    const { client } = setup();
    vi.mocked(api.pickStorageFolder).mockResolvedValueOnce({ selected: true, root_path: "D:\\picked" });
    fireEvent.click(await screen.findByRole("button", { name: "编辑连接 Local" }));
    fireEvent.click(screen.getByRole("button", { name: "浏览本地目录" }));
    await waitFor(() => expect(api.pickStorageFolder).toHaveBeenCalledWith("default-local"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "本地根目录" })).toHaveValue("D:\\picked"));
    vi.mocked(api.pickStorageFolder).mockResolvedValueOnce({ selected: false, root_path: "D:\\picked" });
    await waitFor(() => expect(screen.getByRole("button", { name: "浏览本地目录" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "浏览本地目录" }));
    await waitFor(() => expect(api.pickStorageFolder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "浏览本地目录" })).toBeEnabled());
    expect(screen.getByRole("textbox", { name: "本地根目录" })).toHaveValue("D:\\picked");
    expect(api.updateStorage).not.toHaveBeenCalled();
    client.clear();
  });

  it("discards unsaved edits on close and keeps the editor open after saving configuration", async () => {
    const { client } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "编辑连接 Local" }));
    fireEvent.change(screen.getByRole("textbox", { name: "连接名称" }), { target: { value: "Discarded" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.updateStorage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "编辑连接 Local" }));
    expect(screen.getByRole("textbox", { name: "连接名称" })).toHaveValue("Local");
    fireEvent.change(screen.getByRole("textbox", { name: "连接名称" }), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.updateStorage).toHaveBeenCalledWith("default-local", { name: "Renamed", config: { root_path: "C:\\files" } }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    client.clear();
  });

  it("retains creation drafts on failure and cancels without another request", async () => {
    const { client } = setup();
    await screen.findByRole("button", { name: "编辑连接 Local" });
    vi.mocked(api.createStorage).mockRejectedValueOnce(new Error("Unable to save"));
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    fireEvent.change(screen.getByRole("textbox", { name: "连接名称" }), { target: { value: "Other" } });
    fireEvent.change(screen.getByRole("textbox", { name: "本地根目录" }), { target: { value: "D:\\other" } });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    expect(await within(screen.getByRole("dialog")).findByText("Unable to save")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "连接名称" })).toHaveValue("Other");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.createStorage).toHaveBeenCalledOnce();
    client.clear();
  });

  it("deletes only the edited connection directly and does not delete on close", async () => {
    const { client } = setup();
    await screen.findByRole("button", { name: "编辑连接 Local" });
    client.setQueryData(["storages"], [{ storage_id: "other-local", provider_type: "local", name: "Other", revision: 1, busy: false, config: { root_path: "D:\\other" } }]);
    fireEvent.click(await screen.findByRole("button", { name: "编辑连接 Other" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.deleteStorage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "编辑连接 Other" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(api.deleteStorage).toHaveBeenCalledWith("other-local"));
    expect(api.deleteStorage).toHaveBeenCalledOnce();
    expect(screen.queryByText("删除存储连接")).not.toBeInTheDocument();
    client.clear();
  });

});
