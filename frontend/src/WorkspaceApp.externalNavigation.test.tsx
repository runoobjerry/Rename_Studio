import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api/client";
import { openBrowserFolder, type NavigationReply, type BrowserNavigationRequest } from "./integrations/browser/navigation";
import { deferred } from "./test/deferred";
import { status, storages, listing, providerDefinitions } from "./test/fixtures";
import { client, serverSettings } from "./test/workspaceHarness";
import { installWorkspaceAppTestHooks, renderWorkspace } from "./test/workspaceAppHarness";
import { readWorkspaceSession } from "./workspace/workspaceSession";
import { useRenameStore } from "./stores/useRenameStore";
import { cloneRule, DEFAULT_RULES } from "./features/rules/RuleEditor";
import { browserChannel } from "./test/browserChannel";
import { installBrowserBridge } from "./integrations/browser/browserBridge";
import { BROWSER_NAMESPACE, BROWSER_ORIGIN } from "./integrations/browser/protocol";
import type { DirectoryListing, StorageInfo } from "./types";

vi.mock("./api/client", async (importOriginal) => {
  const { workspaceApiMock } = await import("./test/workspaceApiMock");
  return workspaceApiMock(await importOriginal<typeof import("./api/client")>());
});
installWorkspaceAppTestHooks();
const cid = "0123456789ABCDEF";
const target: BrowserNavigationRequest = { version: 1, type: "open-onedrive-folder",
  request_id: "external-1", account_cid: cid, folder_id: "target-id", drive_id: "default-drive" };
const directory = (): DirectoryListing => ({ provider: "onedrive", storage_id: "user-onedrive",
  revision: 1, directory_id: "target-id", drive_id: "default-drive", location: { kind: "id", value: "target-id" },
  path: "Target", parent_path: "", items: [{ ...listing(1).items[0], id: "target-file", name: "target-file.txt" }] });
beforeEach(() => {
  vi.mocked(api.fetchStorages).mockResolvedValue(storages().map((entry) =>
    entry.provider_type === "onedrive" ? { ...entry, account_id: cid } : entry));
  vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue(status(cid));
  vi.mocked(api.fetchStorageFiles).mockImplementation(async (id, location) =>
    id === "user-onedrive" ? directory() : { ...listing(1), location });
});
function start(request: BrowserNavigationRequest = target) {
  let reply: NavigationReply | undefined;
  const accepted = vi.fn();
  act(() => { void openBrowserFolder(request, accepted).then((result) => { reply = result; }); });
  return { accepted, reply: async () => {
    await waitFor(() => expect(reply).toBeDefined());
    return reply!;
  } };
}
async function mount() {
  renderWorkspace();
  await screen.findByText("file-0.txt");
  await waitFor(() => expect(client.getQueryState(["storages"])?.status).toBe("success"));
}

describe("external Google Drive navigation", () => {
  const storageId = "user-google";
  const accountId = "google-permission-id";
  const request: BrowserNavigationRequest = { version: 1, type: "open-google-drive-folder",
    request_id: "google-1", account_email: "ME@example.test", location: { kind: "id", value: "target-id" } };

  beforeEach(() => {
    const definitions = providerDefinitions();
    vi.mocked(api.fetchStorageProviders).mockResolvedValue([...definitions, { ...definitions[1],
      provider_type: "google_drive", browser_navigation: "google_drive_my_drive", locations: ["root", "id"] }]);
    const connections = storages();
    vi.mocked(api.fetchStorages).mockResolvedValue([...connections, { ...connections[1], storage_id: storageId,
      provider_type: "google_drive", account_id: accountId, account_email: "me@example.test", name: "Google Drive" }]);
    vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue(status(accountId));
    vi.mocked(api.fetchStorageFiles).mockImplementation(async (id, location) => id === storageId
      ? { ...directory(), provider: "google_drive", storage_id: storageId, location, drive_id: null }
      : { ...listing(1), location });
  });

  it("opens the email-matched folder using the connection's stable account identity", async () => {
    await mount();
    expect(await start(request).reply()).toMatchObject({ status: "opened", storage_id: storageId });
    expect(api.fetchStorageFiles).toHaveBeenCalledWith(storageId, request.location);
    await waitFor(() => expect(readWorkspaceSession().session.locations[storageId]?.accountId).toBe(accountId));
  });
});

describe("external OneDrive navigation", () => {
  it("opens a non-builtin provider through its declared navigation adapter", async () => {
    vi.mocked(api.fetchStorageProviders).mockResolvedValue(providerDefinitions().map((entry) =>
      entry.browser_navigation === "onedrive_personal" ? { ...entry, provider_type: "fixture_service" } : entry));
    vi.mocked(api.fetchStorages).mockResolvedValue(storages().map((entry) => entry.storage_id === "user-onedrive"
      ? { ...entry, provider_type: "fixture_service", account_id: cid } : entry));
    vi.mocked(api.fetchStorageFiles).mockImplementation(async (id, location) => id === "user-onedrive"
      ? { ...directory(), provider: "fixture_service" } : { ...listing(1), location });
    await mount();
    expect(await start().reply()).toMatchObject({ status: "opened", storage_id: "user-onedrive" });
    await screen.findByText("target-file.txt");
  });

  it("opens through the validated browser message entry and reports accepted before opened", async () => {
    await mount();
    const channel = browserChannel();
    const dispose = installBrowserBridge(vi.fn(), channel.host);
    try {
      act(() => channel.dispatch({ namespace: BROWSER_NAMESPACE, direction: "extension-to-app",
        version: 1, type: "navigate", request_id: target.request_id, request: target }));
      await screen.findByText("target-file.txt");
      await waitFor(() => expect(channel.post).toHaveBeenCalledWith(expect.objectContaining({
        reply: { version: 1, request_id: target.request_id, status: "opened", storage_id: "user-onedrive" },
      }), BROWSER_ORIGIN));
      const statuses = channel.post.mock.calls.map(([data]) => (data as { reply: NavigationReply }).reply.status);
      expect(statuses).toEqual(["accepted", "opened"]);
    } finally { dispose(); }
  });
  it("opens the specified account directory, refreshes a cached target and preserves defaults and rules", async () => {
    serverSettings.preferences.cloud_default_locations["user-onedrive"] = {
      account_id: cid, location: { kind: "id", value: "remembered-default" },
    };
    useRenameStore.getState().setRules([{ ...cloneRule(DEFAULT_RULES.insert),
      config: { ...DEFAULT_RULES.insert.config, text: "kept-" } }]);
    await mount();
    const rules = useRenameStore.getState().rules;
    // A known authorized connection needs no extra status/connection confirmation on navigation.
    client.setQueryData(["storage-auth", "user-onedrive", 1], status(cid));
    const connectionReads = vi.mocked(api.fetchStorages).mock.calls.length;
    const authReads = vi.mocked(api.fetchStorageAuthStatus).mock.calls.length;
    client.setQueryData(["files", "user-onedrive", 1, { kind: "id", value: "target-id" }],
      { ...directory(), path: "Stale", items: [] });
    const operation = start();
    expect(await operation.reply()).toMatchObject({ status: "opened", storage_id: "user-onedrive" });
    expect(operation.accepted).toHaveBeenCalledWith({ version: 1, request_id: target.request_id, status: "accepted" });
    await screen.findByText("target-file.txt");
    expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "id", value: "target-id" });
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", { kind: "id", value: "remembered-default" });
    await waitFor(() => expect(readWorkspaceSession().session.locations["user-onedrive"].location)
      .toEqual({ kind: "id", value: "target-id" }));
    expect(api.patchAppSettings).not.toHaveBeenCalled();
    expect(api.fetchStorages).toHaveBeenCalledTimes(connectionReads);
    expect(api.fetchStorageAuthStatus).toHaveBeenCalledTimes(authReads);
    expect(useRenameStore.getState().rules).toEqual(rules);
    expect(useRenameStore.getState().selectedIds).toEqual([]);
  });

  it.each(["missing", "ambiguous", "unauthorized"])("does not change workspace when the account is %s", async (kind) => {
    if (kind === "ambiguous") {
      const connections = await api.fetchStorages();
      vi.mocked(api.fetchStorages).mockResolvedValue([...connections, { ...connections[1], storage_id: "duplicate" }]);
    }
    if (kind === "unauthorized") vi.mocked(api.fetchStorageAuthStatus).mockResolvedValue(status(cid, false));
    await mount();
    if (kind === "unauthorized") client.setQueryData(["storage-auth", "user-onedrive", 1], status(cid, false));
    const operation = start(kind === "missing" ? { ...target, account_cid: "FEDCBA9876543210" } : target);
    expect(await operation.reply()).toMatchObject({ status: "rejected",
      code: kind === "unauthorized" ? "auth_required" : "connection_not_found" });
    expect(screen.getByText("file-0.txt")).toBeInTheDocument();
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", expect.anything());
  });

  it("lets an external target win over account A restoration while switching to account B", async () => {
    const accountA = "111111111111AAAA";
    const connections = await api.fetchStorages();
    vi.mocked(api.fetchStorages).mockResolvedValue([...connections,
      { ...connections[1], storage_id: "account-a-connection", name: "Account A", account_id: accountA }]);
    vi.mocked(api.fetchStorageAuthStatus).mockImplementation(async (id) => status(id === "account-a-connection" ? accountA : cid));
    serverSettings.preferences.cloud_default_locations["account-a-connection"] = {
      account_id: accountA, location: { kind: "id", value: "account-a-default" },
    };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Account A" }));
    const operation = start();
    expect(await operation.reply()).toMatchObject({ status: "opened", storage_id: "user-onedrive" });
    await screen.findByText("target-file.txt");
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", { kind: "id", value: "account-a-default" });
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", { kind: "root" });
  });

  it.each(["default-local", "user-onedrive"])("rejects a busy connection %s before changing workspace", async (id) => {
    const connections = await api.fetchStorages();
    vi.mocked(api.fetchStorages).mockResolvedValue(connections.map((entry) =>
      entry.storage_id === id ? { ...entry, busy: true } : entry));
    await mount();
    expect(await start().reply()).toMatchObject({ status: "rejected", code: "busy" });
    expect(screen.getByText("file-0.txt")).toBeInTheDocument();
  });

  it("releases the previous preview before opening the target", async () => {
    await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择当前显示且可修改名称的全部项目" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(useRenameStore.getState().previewActive).toBe(true));
    expect((await start().reply()).status).toBe("opened");
    expect(api.releaseStoragePreview).toHaveBeenCalledWith("default-local", "task-preview");
    expect(useRenameStore.getState().task).toBeNull();
    expect(useRenameStore.getState().previewActive).toBe(false);
  });

  it("preserves unresolved write records and rejects navigation", async () => {
    await mount();
    // Existing unresolved write is the precondition; the operation under test uses the public business entry.
    const unknown = { storageId: "default-local", previewId: "unknown-write", items: [] };
    act(() => useRenameStore.getState().setUnknownExecution(unknown));
    expect(await start().reply()).toMatchObject({ status: "rejected", code: "outcome_unresolved" });
    expect(useRenameStore.getState().unknownExecution).toBe(unknown);
    expect(screen.getByText("file-0.txt")).toBeInTheDocument();
  });

  it("rejects while previewing and does not queue a later jump", async () => {
    const response = deferred<Awaited<ReturnType<typeof api.createStoragePreview>>>();
    vi.mocked(api.createStoragePreview).mockReturnValue(response.promise);
    await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择当前显示且可修改名称的全部项目" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(api.createStoragePreview).toHaveBeenCalled());
    expect(await start().reply()).toMatchObject({ status: "rejected", code: "busy" });
    await act(async () => response.resolve({ preview_id: "preview", expires_at: "2099-01-01", valid: true, items: [] }));
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", expect.anything());
  });

  it("rejects while a direct single rename is writing", async () => {
    const response = deferred<Awaited<ReturnType<typeof api.executeStorageSingleRename>>>();
    vi.mocked(api.executeStorageSingleRename).mockReturnValueOnce(response.promise);
    await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 file-0.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "重命名 file-0.txt" }));
    const dialog = within(screen.getByRole("dialog", { name: "重命名" }));
    fireEvent.change(dialog.getByRole("textbox", { name: "新名称" }), { target: { value: "renamed" } });
    fireEvent.click(dialog.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(api.executeStorageSingleRename).toHaveBeenCalled());
    expect(await start().reply()).toMatchObject({ status: "rejected", code: "busy" });
    await act(async () => response.reject(new api.ApiError(409, "Conflict", "RENAME_CONFLICT")));
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", expect.anything());
  });

  it("rejects while batch execution is writing", async () => {
    const response = deferred<Awaited<ReturnType<typeof api.executePreview>>>();
    vi.mocked(api.executePreview).mockReturnValueOnce(response.promise);
    await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择当前显示且可修改名称的全部项目" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "开始修改" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(api.executePreview).toHaveBeenCalled());
    expect(await start().reply()).toMatchObject({ status: "rejected", code: "busy" });
    await act(async () => response.reject(new api.ApiError(409, "Busy", "STORAGE_BUSY")));
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", expect.anything());
  });

  it.each(["manual", "revision", "account"])("cancels a late directory response after %s changes", async (kind) => {
    const response = deferred<DirectoryListing>();
    vi.mocked(api.fetchStorageFiles).mockImplementation(async (id, location) =>
      id === "user-onedrive" ? response.promise : { ...listing(1), location });
    await mount();
    const operation = start();
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledWith("user-onedrive", { kind: "id", value: "target-id" }));
    const second = start({ ...target, request_id: "second" });
    expect(await second.reply()).toMatchObject({ status: "rejected", code: "busy" });
    expect(second.accepted).not.toHaveBeenCalled();
    if (kind === "manual") fireEvent.click(screen.getByRole("button", { name: "本地文件" }));
    else if (kind === "account") act(() => client.setQueryData(["storage-auth", "user-onedrive", 1], status("FEDCBA9876543210")));
    else act(() => client.setQueryData<StorageInfo[]>(["storages"], (entries) => entries!.map((entry) =>
      entry.storage_id === "user-onedrive" ? { ...entry, revision: 2 } : entry)));
    expect(await operation.reply()).toMatchObject({ status: "rejected", code: "cancelled" });
    await act(async () => response.resolve(directory()));
    if (kind === "manual") {
      await screen.findByText("file-0.txt");
      expect(screen.queryByText("target-file.txt")).not.toBeInTheDocument();
    }
  });

  it("accepts a root ID canonicalized to root without a drive ID", async () => {
    vi.mocked(api.fetchStorageFiles).mockImplementation(async (id, location) => id === "user-onedrive"
      ? { ...directory(), location: { kind: "root" }, path: "", drive_id: null } : { ...listing(1), location });
    await mount();
    expect(await start({ ...target, drive_id: undefined }).reply()).toMatchObject({ status: "opened" });
    await waitFor(() => expect(readWorkspaceSession().session.locations["user-onedrive"].location).toEqual({ kind: "root" }));
  });
  it("does not display or accept a listing returned for a different folder", async () => {
    vi.mocked(api.fetchStorageFiles).mockImplementation(async (id, location) => id === "user-onedrive"
      ? { ...directory(), directory_id: "different-folder" } : { ...listing(1), location });
    await mount();
    expect(await start().reply()).toMatchObject({ status: "rejected", code: "cancelled" });
    expect(screen.queryByText("target-file.txt")).not.toBeInTheDocument();
    expect(readWorkspaceSession().session.locations["user-onedrive"]).toBeUndefined();
  });

  it("does not bypass drive scope verification on retry", async () => {
    vi.mocked(api.fetchStorageFiles).mockImplementation(async (id, location) => id === "user-onedrive"
      ? { ...directory(), drive_id: "other-drive" } : { ...listing(1), location });
    await mount();
    expect(await start().reply()).toMatchObject({ status: "rejected", code: "unsupported_scope" });
    fireEvent.click(screen.getByRole("button", { name: "重试读取目录" }));
    await waitFor(() => expect(api.fetchStorageFiles).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("target-file.txt")).not.toBeInTheDocument();
    expect(readWorkspaceSession().session.locations["user-onedrive"]).toBeUndefined();
  });

  it.each([[403, "PERMISSION_DENIED"], [401, "AUTHENTICATION_ERROR"]] as const)("preserves the real read error %s and lets the user retry without falling back to root", async (httpStatus, code) => {
    let fail = true;
    vi.mocked(api.fetchStorageFiles).mockImplementation(async (id, location) => {
      if (id !== "user-onedrive") return { ...listing(1), location };
      if (fail) throw new api.ApiError(httpStatus, "Denied", code);
      return directory();
    });
    await mount();
    expect(await start().reply()).toMatchObject({ status: "rejected", code });
    expect(readWorkspaceSession().session.locations["user-onedrive"]).toBeUndefined();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "重试读取目录" }));
    await screen.findByText("target-file.txt");
    expect(api.fetchStorageFiles).not.toHaveBeenCalledWith("user-onedrive", { kind: "root" });
  });
});
