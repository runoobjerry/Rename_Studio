import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/client";
import { NotificationProvider } from "../../components/NotificationProvider";
import { StorageSettingsPanel } from "./StorageSettingsPanel";
import { i18n } from "../../i18n";
import type { StorageConfigField, StorageProviderDefinition } from "../../types";

vi.mock("../../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  fetchStorageAuthStatus: vi.fn(), fetchStorages: vi.fn(), fetchStorageProviders: vi.fn(), createStorage: vi.fn(), updateStorage: vi.fn(), deleteStorage: vi.fn(), disconnectStorage: vi.fn(), pickStorageFolder: vi.fn(), pickLocalFolderDraft: vi.fn(), startStorageAuth: vi.fn(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

function field(key: string, label: string, options: Partial<StorageConfigField> = {}): StorageConfigField {
  return { key, label, create_label: null, input_type: "text", target: "config", required: false,
    nullable: false, help_text: null, create_help_text: null, saved_help_text: null, ...options };
}

const directoryDefinition: StorageProviderDefinition = {
  provider_type: "fixture_directory", name: "Local", locations: ["root", "path"], browser_auth: false,
  local_picker: true, can_rename: true, config_schema: {}, account_label: "用户", icon: "computer",
  config_fields: [field("directory", "工作目录", { input_type: "directory", required: true })],
};
const authDefinition: StorageProviderDefinition = {
  provider_type: "fixture_oauth", name: "OAuth", locations: ["root", "id"], browser_auth: true,
  local_picker: false, can_rename: true, config_schema: {}, account_label: "授权用户", icon: "cloud",
  config_fields: [
    field("application_id", "应用 ID", { create_label: "应用 ID（可稍后配置）", nullable: true }),
    field("client_secret", "凭据密钥", { input_type: "password", target: "client_secret",
      saved_help_text: "已保存密钥；留空保留原值。更改客户端配置后需重新登录。" }),
  ],
};

function setup(executingStorageId?: string) {
  const storage = { storage_id: "default-local", provider_type: "fixture_directory", name: "Local", revision: 1, busy: false, config: { directory: "C:\\files" }, account_id: null, account_display_name: null, account_email: null };
  vi.mocked(api.fetchStorages).mockResolvedValue([storage]);
  vi.mocked(api.fetchStorageProviders).mockResolvedValue([directoryDefinition, authDefinition]);
  vi.mocked(api.createStorage).mockResolvedValue({ ...storage, storage_id: "new-storage" });
  vi.mocked(api.updateStorage).mockResolvedValue(storage);
  vi.mocked(api.deleteStorage).mockResolvedValue(undefined);
  vi.mocked(api.disconnectStorage).mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><NotificationProvider><StorageSettingsPanel executingStorageId={executingStorageId} /></NotificationProvider></QueryClientProvider>);
  return { client, ...view };
}

describe("storage settings", () => {
  it("updates an open editor while preserving drafts and backend display fields", async () => {
    const { client } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "编辑连接 Local" }));
    fireEvent.change(screen.getByRole("textbox", { name: "连接名称" }), { target: { value: "自定义连接" } });
    fireEvent.change(screen.getByRole("textbox", { name: "工作目录" }), { target: { value: "D:\\自定义目录" } });
    const requestCount = vi.mocked(api.fetchStorageProviders).mock.calls.length;
    await act(async () => { await i18n.changeLanguage("en-US"); });
    expect(screen.getByRole("dialog", { name: "Local settings" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Connection name" })).toHaveValue("自定义连接");
    expect(screen.getByRole("textbox", { name: "工作目录" })).toHaveValue("D:\\自定义目录");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(api.fetchStorageProviders).toHaveBeenCalledTimes(requestCount);
    expect(api.updateStorage).not.toHaveBeenCalled();
    expect(api.createStorage).not.toHaveBeenCalled();
    client.clear();
  });
  it("blocks editing and creation when provider definitions are unavailable", async () => {
    const { client } = setup();
    await screen.findByRole("button", { name: "编辑连接 Local" });
    vi.mocked(api.fetchStorageProviders).mockResolvedValue([]);
    await act(async () => { client.setQueryData(["storage-providers"], []); });
    // 缓存同步更新后，Query 的组件通知仍可能等待调度；等待最终界面再继续操作。
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "编辑连接 Local" })).not.toBeInTheDocument();
      expect(screen.getByText("服务定义尚未就绪，暂时无法编辑。")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    fireEvent.change(screen.getByRole("textbox", { name: "连接名称" }), { target: { value: "Draft" } });
    expect(screen.getByRole("button", { name: "保存连接" })).toBeDisabled();
    expect(api.fetchStorageAuthStatus).not.toHaveBeenCalled();
    expect(api.createStorage).not.toHaveBeenCalled();
    client.clear();
  });

  it("renders and submits arbitrary provider fields and uses picker/auth capabilities instead of provider names", async () => {
    const { client } = setup();
    await screen.findByRole("button", { name: "编辑连接 Local" });
    const definition: StorageProviderDefinition = {
      ...directoryDefinition, provider_type: "fixture_storage", name: "测试存储",
      config_fields: [
        field("mount_path", "挂载目录", { input_type: "directory", required: true }),
        field("tenant", "租户", { nullable: true }),
      ],
    };
    const definitions = [directoryDefinition, definition];
    vi.mocked(api.fetchStorageProviders).mockResolvedValue(definitions);
    await act(async () => { client.setQueryData(["storage-providers"], definitions); });
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "存储类型" }));
    fireEvent.click(await screen.findByRole("option", { name: "测试存储" }));
    fireEvent.change(screen.getByRole("textbox", { name: "连接名称" }), { target: { value: "Fixture" } });
    expect(screen.getByRole("button", { name: "保存连接" })).toBeDisabled();
    vi.mocked(api.pickLocalFolderDraft).mockResolvedValueOnce({ selected: true, root_path: "D:\\fixture" });
    fireEvent.click(screen.getByRole("button", { name: "浏览本地目录" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "挂载目录" })).toHaveValue("D:\\fixture"));
    expect(api.pickStorageFolder).not.toHaveBeenCalled();
    expect(api.updateStorage).not.toHaveBeenCalled();
    expect(api.createStorage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() => expect(api.createStorage).toHaveBeenCalledWith({
      provider_type: "fixture_storage", name: "Fixture", config: { mount_path: "D:\\fixture", tenant: null },
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const storage = { storage_id: "fixture", provider_type: "fixture_storage", name: "Fixture", revision: 1,
      busy: false, config: { mount_path: "D:\\fixture", tenant: "team" },
      account_id: null, account_display_name: null, account_email: null };
    vi.mocked(api.fetchStorages).mockResolvedValue([storage]);
    await act(async () => { client.setQueryData(["storages"], [storage]); });
    fireEvent.click(await screen.findByRole("button", { name: "编辑连接 Fixture" }));
    expect(screen.getByRole("textbox", { name: "挂载目录" })).toHaveValue("D:\\fixture");
    fireEvent.change(screen.getByRole("textbox", { name: "租户" }), { target: { value: " updated " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.updateStorage).toHaveBeenCalledWith("fixture", {
      name: "Fixture", config: { mount_path: "D:\\fixture", tenant: "updated" },
    }));
    expect(api.fetchStorageAuthStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "登录账号" })).not.toBeInTheDocument();
    client.clear();
  });

  it("keeps an existing secret when editing blank and clears a new secret only after a successful save", async () => {
    const { client } = setup();
    await screen.findByRole("button", { name: "编辑连接 Local" });
    const storage = { storage_id: "oauth", provider_type: "fixture_oauth", name: "OAuth", revision: 1,
      busy: false, config: { application_id: "desktop-id" }, has_client_secret: true,
      account_id: null, account_display_name: null, account_email: null };
    vi.mocked(api.fetchStorages).mockResolvedValue([storage]);
    vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue({ configured: true, connected: false,
      account_id: null, account_display_name: null, account_email: null });
    await act(async () => { client.setQueryData(["storages"], [storage]); });
    fireEvent.click(await screen.findByRole("button", { name: "编辑连接 OAuth" }));
    expect(screen.getByLabelText("凭据密钥")).toHaveValue("");
    expect(screen.getByText(/已保存密钥/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.updateStorage).toHaveBeenCalledWith("oauth", {
      name: "OAuth", config: { application_id: "desktop-id" },
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());
    vi.mocked(api.updateStorage).mockRejectedValueOnce(new Error("Save failed"));
    fireEvent.change(screen.getByLabelText("凭据密钥"), { target: { value: "replacement-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await within(screen.getByRole("dialog")).findByText("Save failed");
    expect(screen.getByLabelText("凭据密钥")).toHaveValue("replacement-secret");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByLabelText("凭据密钥")).toHaveValue(""));
    expect(api.updateStorage).toHaveBeenLastCalledWith("oauth", {
      name: "OAuth", config: { application_id: "desktop-id" }, client_secret: "replacement-secret",
    });
    client.clear();
  });

  it("creates a metadata-defined connection with a top-level write-only secret and clears it when changing provider or reopening", async () => {
    const { client } = setup();
    await screen.findByRole("button", { name: "编辑连接 Local" });
    const definitions: StorageProviderDefinition[] = [
      directoryDefinition, authDefinition,
    ];
    vi.mocked(api.fetchStorageProviders).mockResolvedValue(definitions);
    client.setQueryData(["storage-providers"], definitions);
    await screen.findByRole("button", { name: "编辑连接 Local" });
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    const select = async (name: string) => {
      fireEvent.mouseDown(screen.getByRole("combobox", { name: "存储类型" }));
      fireEvent.click(await screen.findByRole("option", { name }));
    };
    await select("OAuth");
    fireEvent.change(screen.getByLabelText("凭据密钥"), { target: { value: "discarded-secret" } });
    await select("Local");
    await select("OAuth");
    expect(screen.getByLabelText("凭据密钥")).toHaveValue("");
    expect(screen.getByLabelText("凭据密钥")).toHaveAttribute("type", "password");
    fireEvent.change(screen.getByRole("textbox", { name: "连接名称" }), { target: { value: "OAuth" } });
    fireEvent.change(screen.getByRole("textbox", { name: "应用 ID（可稍后配置）" }), { target: { value: "desktop-id" } });
    fireEvent.change(screen.getByLabelText("凭据密钥"), { target: { value: "fixture-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() => expect(api.createStorage).toHaveBeenCalledWith({
      provider_type: "fixture_oauth", name: "OAuth", config: { application_id: "desktop-id" }, client_secret: "fixture-secret",
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    await select("OAuth");
    expect(screen.getByLabelText("凭据密钥")).toHaveValue("");
    client.clear();
  });

  it("uses metadata-defined authorization and ignores callbacks from another origin or connection", async () => {
    const { client } = setup();
    await screen.findByRole("button", { name: "编辑连接 Local" });
    const oauth = { storage_id: "oauth", provider_type: "fixture_oauth", name: "OAuth", revision: 1, busy: false,
      config: { application_id: "desktop-id" }, has_client_secret: true, account_id: "account", account_display_name: null, account_email: null };
    vi.mocked(api.fetchStorages).mockResolvedValue([oauth]);
    vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue({ configured: false, connected: false, account_id: null, account_display_name: null, account_email: null });
    client.setQueryData(["storages"], [oauth]);
    fireEvent.click(await screen.findByRole("button", { name: "编辑连接 OAuth" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "登录账号" })).toBeDisabled());
    vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue({ configured: true, connected: false, account_id: null, account_display_name: null, account_email: null });
    await act(async () => { await client.invalidateQueries({ queryKey: ["storage-auth", "oauth"] }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "登录账号" })).toBeEnabled());
    const popup = { location: { href: "" }, closed: false, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    vi.mocked(api.startStorageAuth).mockResolvedValue({ authorization_url: "https://auth.example.test/authorize", redirect_uri: "http://localhost:8000/auth/storage/callback" });
    fireEvent.click(screen.getByRole("button", { name: "登录账号" }));
    await waitFor(() => expect(popup.location.href).toBe("https://auth.example.test/authorize"));
    const callback = (origin: string, storageId: string) => {
      const event = new MessageEvent("message", { origin, data: { type: "storage-auth", storage_id: storageId, status: "connected" } });
      Object.defineProperty(event, "source", { value: popup });
      fireEvent(window, event);
    };
    callback("https://untrusted.example", "oauth");
    callback("http://localhost:8000", "other");
    expect(screen.getByRole("button", { name: "等待授权…" })).toBeDisabled();
    vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue({ configured: true, connected: true, account_id: "account", account_display_name: null, account_email: null });
    callback("http://localhost:8000", "oauth");
    expect(await screen.findByText("授权用户")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeEnabled();
    client.clear();
  });

  it("locks creation while browsing and keeps the draft when the picker is cancelled", async () => {
    const { client } = setup();
    await screen.findByRole("button", { name: "编辑连接 Local" });
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    fireEvent.change(screen.getByRole("textbox", { name: "连接名称" }), { target: { value: "Other" } });
    fireEvent.change(screen.getByRole("textbox", { name: "工作目录" }), { target: { value: "D:\\draft" } });
    let finish!: (result: Awaited<ReturnType<typeof api.pickLocalFolderDraft>>) => void;
    vi.mocked(api.pickLocalFolderDraft).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "浏览本地目录" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "保存连接" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "浏览本地目录" })).toBeDisabled();
    finish({ selected: false, root_path: "C:\\Documents" });
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeEnabled());
    expect(screen.getByRole("textbox", { name: "工作目录" })).toHaveValue("D:\\draft");
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
      storage_id: "user-cloud", provider_type: "fixture_oauth", name: "OAuth", revision: 1,
      busy: false, config: { application_id: "app" }, account_id: "account-a",
      account_display_name: "测试用户", account_email: "user@example.com",
    };
    await screen.findByRole("button", { name: "编辑连接 Local" });
    vi.mocked(api.fetchStorages).mockResolvedValue([cloud]);
    client.setQueryData(["storages"], [cloud]);
    // Wait for the cloud row, not the old Local row's identical status label.
    await screen.findByRole("button", { name: "编辑连接 OAuth" });
    const table = within(screen.getByRole("table", { name: "已保存连接" }));
    await waitFor(() => expect(table.getByText("已连接")).toBeInTheDocument());
    expect(table.queryByText(/测试用户|user@example.com/)).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑连接 OAuth" }));
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

  it("updates the directory field through the inline folder picker and preserves it on cancellation", async () => {
    const { client } = setup();
    vi.mocked(api.pickStorageFolder).mockResolvedValueOnce({ selected: true, root_path: "D:\\picked" });
    fireEvent.click(await screen.findByRole("button", { name: "编辑连接 Local" }));
    fireEvent.click(screen.getByRole("button", { name: "浏览本地目录" }));
    await waitFor(() => expect(api.pickStorageFolder).toHaveBeenCalledWith("default-local"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "工作目录" })).toHaveValue("D:\\picked"));
    vi.mocked(api.pickStorageFolder).mockResolvedValueOnce({ selected: false, root_path: "D:\\picked" });
    await waitFor(() => expect(screen.getByRole("button", { name: "浏览本地目录" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "浏览本地目录" }));
    await waitFor(() => expect(api.pickStorageFolder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "浏览本地目录" })).toBeEnabled());
    expect(screen.getByRole("textbox", { name: "工作目录" })).toHaveValue("D:\\picked");
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
    await waitFor(() => expect(api.updateStorage).toHaveBeenCalledWith("default-local", { name: "Renamed", config: { directory: "C:\\files" } }));
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
    fireEvent.change(screen.getByRole("textbox", { name: "工作目录" }), { target: { value: "D:\\other" } });
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
    client.setQueryData(["storages"], [{ storage_id: "other-local", provider_type: "fixture_directory", name: "Other", revision: 1, busy: false, config: { directory: "D:\\other" } }]);
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
