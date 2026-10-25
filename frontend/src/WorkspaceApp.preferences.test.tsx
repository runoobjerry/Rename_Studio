import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "./api/client";
import { useRenameStore } from "./stores/useRenameStore";
import { readWorkspaceSession, workspaceSessionKey } from "./workspace/workspaceSession";
import { client, serverSettings } from "./test/workspaceHarness";
import { installWorkspaceAppTestHooks, renderWorkspace } from "./test/workspaceAppHarness";
import type { AppSettings } from "./types";

vi.mock("./api/client", async (importOriginal) => {
  const { workspaceApiMock } = await import("./test/workspaceApiMock");
  return workspaceApiMock(await importOriginal<typeof import("./api/client")>());
});
installWorkspaceAppTestHooks();

describe("language settings", () => {
  it("updates an existing preview and confirmation without changing task, selection, order, or requests", async () => {
    const items = ["文件2.txt", "文件10.txt"].map((name) => ({
      id: name, name, path: name, parent_path: "", is_directory: false, size: 1, modified_at: null,
    }));
    vi.mocked(api.fetchStorageFiles).mockResolvedValue({
      provider: "local", path: "", parent_path: null, location: { kind: "root" }, items,
    });
    vi.mocked(api.createStoragePreview).mockImplementation(async (_storage, _location, ids) => ({
      preview_id: "language-preview", expires_at: "2099-01-01T00:00:00Z", valid: true,
      items: ids.map((id) => ({ file_id: id, original_name: id, new_name: `新-${id}`, changed: true, valid: true, conflict: false, error: null })),
    }));
    renderWorkspace();
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前显示的全部项目" }));
    fireEvent.click(screen.getByRole("button", { name: "文件名" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始修改" })).toBeEnabled());
    const before = useRenameStore.getState();
    const filesRequests = vi.mocked(api.fetchStorageFiles).mock.calls.length;
    const fileOrder = () => within(screen.getByRole("table", { name: /(?:文件列表|file list)$/ }))
      .getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[1].textContent);
    const originalOrder = fileOrder();
    fireEvent.click(screen.getByRole("button", { name: "开始修改" }));
    await act(async () => {
      client.setQueryData<AppSettings>(["app-settings"], { preferences: { ...serverSettings.preferences, language: "en-US" } });
    });
    expect(await screen.findByRole("heading", { name: "Awaiting confirmation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("table", { name: "Preview" })).toHaveTextContent("新-文件10.txt");
    expect(screen.getByRole("checkbox", { name: "Select file 文件2.txt" })).toBeChecked();
    expect(screen.getByRole("columnheader", { name: "File name" })).toHaveAttribute("aria-sort", "descending");
    expect(fileOrder()).toEqual(originalOrder);
    expect(useRenameStore.getState().selectedIds).toEqual(before.selectedIds);
    expect(useRenameStore.getState().rules).toBe(before.rules);
    expect(api.createStoragePreview).toHaveBeenCalledOnce();
    expect(api.executePreview).not.toHaveBeenCalled();
    expect(api.releaseStoragePreview).not.toHaveBeenCalled();
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(filesRequests);
    fireEvent.click(screen.getByRole("button", { name: "Start renaming" }));
    await act(async () => { client.setQueryData(["app-settings"], serverSettings); });
    expect(await screen.findByRole("heading", { name: "等待确认" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fileOrder()).toEqual(originalOrder);
  });

  it("switches through the menu, preserves workspace state, and reports a failed save", async () => {
    vi.mocked(api.fetchStorageFiles).mockResolvedValue({
      provider: "local", path: "", parent_path: null, location: { kind: "root" },
      items: [{ id: "keep.txt", name: "keep.txt", path: "keep.txt", parent_path: "", is_directory: false, size: 1, modified_at: null }],
    });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择文件 keep.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const menu = await screen.findByRole("combobox", { name: "界面语言" });
    const filesRequests = vi.mocked(api.fetchStorageFiles).mock.calls.length;
    const metadataRequests = vi.mocked(api.fetchStorageProviders).mock.calls.length;
    fireEvent.mouseDown(menu);
    fireEvent.click(screen.getByRole("option", { name: "English" }));
    await screen.findByRole("button", { name: "Back to workspace" });
    await waitFor(() => expect(serverSettings.preferences.language).toBe("en-US"));
    expect(document.documentElement.lang).toBe("en-US");
    expect(api.fetchStorageFiles).toHaveBeenCalledTimes(filesRequests);
    expect(api.fetchStorageProviders).toHaveBeenCalledTimes(metadataRequests);
    expect(useRenameStore.getState().selectedIds).toEqual(["keep.txt"]);

    vi.mocked(api.patchAppSettings).mockRejectedValueOnce(new Error("Offline"));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Language" }));
    fireEvent.click(screen.getByRole("option", { name: "简体中文" }));
    expect(await screen.findByText("Could not save the language. The change was reverted: Offline")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveTextContent("English");
    expect(document.documentElement.lang).toBe("en-US");
    fireEvent.click(screen.getByRole("button", { name: "Back to workspace" }));
    expect(await screen.findByRole("checkbox", { name: "Select file keep.txt" })).toBeChecked();
  });

  it("uses browser auto and a localized warning when settings cannot be read", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
    vi.mocked(api.fetchAppSettings).mockRejectedValue(new Error("Offline"));
    renderWorkspace();
    expect(await screen.findByText("Could not load app settings. Using default preferences: Offline")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en-US");
    expect(api.patchAppSettings).not.toHaveBeenCalled();
  });
});

describe("factory reset", () => {
  const openSettings = async () => {
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    return screen.findByRole("button", { name: "将应用还原为原始默认状态" });
  };

  it("keeps current settings and rules when reset fails", async () => {
    window.sessionStorage.setItem(workspaceSessionKey, JSON.stringify({
      version: 1, activeStorageId: "default-local", locations: {
        "default-local": { revision: 1, accountId: null, location: { kind: "path", value: "保留目录" } },
      },
    }));
    serverSettings.preferences.theme = "dark";
    useRenameStore.setState({ rules: [{ type: "insert", enabled: true, config: { text: "keep" } }] });
    vi.mocked(api.factoryResetAppSettings).mockRejectedValueOnce(new Error("Disk unavailable"));
    fireEvent.click(await openSettings());
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认重置？" }))
      .getByRole("button", { name: "重置" }));
    expect(await screen.findByText(/恢复出厂设置失败：Disk unavailable/)).toBeInTheDocument();
    expect(useRenameStore.getState().rules).toHaveLength(1);
    expect(serverSettings.preferences.theme).toBe("dark");
    expect(screen.getByRole("dialog", { name: "确认重置？" })).toBeInTheDocument();
    expect(readWorkspaceSession().session.locations["default-local"].location).toEqual({ kind: "path", value: "保留目录" });
    expect(readWorkspaceSession().session.activeStorageId).toBe("default-local");
  });
});
