import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api/client";
import WorkspaceApp from "./WorkspaceApp";
import { readDefaultCloudPath, saveDefaultCloudPath } from "./features/files/defaultCloudPath";
import { useRenameStore } from "./stores/useRenameStore";
import type { OneDriveAuthStatus } from "./types";

vi.mock("./api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api/client")>();
  return {
    ...original,
    fetchProviders: vi.fn(), fetchRules: vi.fn(), fetchLocalSettings: vi.fn(),
    fetchOneDriveStatus: vi.fn(), fetchFiles: vi.fn(),
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
  vi.mocked(api.fetchProviders).mockResolvedValue([
    { id: "local", name: "本地文件", writable: true },
    { id: "onedrive", name: "OneDrive", writable: true },
  ]);
  vi.mocked(api.fetchRules).mockResolvedValue([]);
  vi.mocked(api.fetchLocalSettings).mockResolvedValue({ root_path: "C:\\files" });
  vi.mocked(api.fetchOneDriveStatus).mockResolvedValue(status("account-a"));
  vi.mocked(api.fetchFiles).mockImplementation(async (provider, path) => ({
    provider, path, parent_path: path ? "" : null, items: [],
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

describe("cloud default path integration", () => {
  it("restores on provider entry and re-entry, saves the opened path rather than unsent text", async () => {
    saveDefaultCloudPath("onedrive", "account-a", "照片");
    await openCloud();
    expect(screen.getByRole("textbox", { name: "云端文件夹路径" })).toHaveValue("照片");
    expect(api.fetchFiles).toHaveBeenCalledWith("onedrive", "照片");
    expect(api.fetchFiles).not.toHaveBeenCalledWith("onedrive", "");
    fireEvent.change(screen.getByRole("textbox", { name: "云端文件夹路径" }), { target: { value: "未打开" } });
    fireEvent.click(screen.getByRole("button", { name: "设为默认路径" }));
    expect(readDefaultCloudPath("onedrive", "account-a")).toBe("照片");
    expect(await screen.findByText("已将“照片”设为当前账号的默认路径。")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "云端文件夹路径" }), { target: { value: "文档" } });
    fireEvent.click(screen.getByRole("button", { name: "打开文件夹" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "设为默认路径" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "设为默认路径" }));
    expect(readDefaultCloudPath("onedrive", "account-a")).toBe("文档");
    fireEvent.click(screen.getByRole("button", { name: "本地文件" }));
    fireEvent.click(screen.getByRole("button", { name: "OneDrive" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "云端文件夹路径" })).toHaveValue("文档"));
  });

  it("switches accounts without reusing the previous directory or selection", async () => {
    saveDefaultCloudPath("onedrive", "account-a", "a-folder");
    saveDefaultCloudPath("onedrive", "account-b", "b-folder");
    await openCloud();
    useRenameStore.setState({ selectedIds: ["old-file"] });
    vi.mocked(api.fetchFiles).mockClear();
    client.setQueryData(["onedrive", "status"], status("account-b"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "云端文件夹路径" })).toHaveValue("b-folder"));
    await waitFor(() => expect(api.fetchFiles).toHaveBeenCalledWith("onedrive", "b-folder"));
    expect(api.fetchFiles).not.toHaveBeenCalledWith("onedrive", "a-folder");
    expect(useRenameStore.getState().selectedIds).toEqual([]);
    client.setQueryData(["onedrive", "status"], status(null, false));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "云端文件夹路径" })).toHaveValue(""));
    expect(readDefaultCloudPath("onedrive", "account-a")).toBe("a-folder");
    client.setQueryData(["onedrive", "status"], status("account-a"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "云端文件夹路径" })).toHaveValue("a-folder"));
  });

  it("keeps browsing available without an account ID but does not save a shared default", async () => {
    vi.mocked(api.fetchOneDriveStatus).mockResolvedValue(status(null));
    render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "OneDrive" }));
    await waitFor(() => expect(api.fetchFiles).toHaveBeenCalledWith("onedrive", ""));
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
    expect(api.fetchFiles).toHaveBeenCalledWith("onedrive", "");
  });

  it("does not overwrite the default when the requested directory fails to load", async () => {
    saveDefaultCloudPath("onedrive", "account-a", "照片");
    await openCloud();
    vi.mocked(api.fetchFiles).mockRejectedValueOnce(new Error("Directory not found"));
    fireEvent.change(screen.getByRole("textbox", { name: "云端文件夹路径" }), { target: { value: "不存在" } });
    fireEvent.click(screen.getByRole("button", { name: "打开文件夹" }));
    await screen.findByText(/目录读取失败/);
    expect(screen.getByRole("button", { name: "设为默认路径" })).toBeDisabled();
    expect(readDefaultCloudPath("onedrive", "account-a")).toBe("照片");
  });
});
