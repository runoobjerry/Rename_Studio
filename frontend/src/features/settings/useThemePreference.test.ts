import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAppSettings, patchAppSettings } from "../../api/client";
import type { AppSettings } from "../../types";
import { useThemePreference } from "./useThemePreference";

vi.mock("../../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/client")>(),
  fetchAppSettings: vi.fn(), patchAppSettings: vi.fn(),
}));

let systemDark: boolean;
let listeners: Set<() => void>;
let serverSettings: AppSettings;
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
const changeSystem = (dark: boolean) => act(() => { systemDark = dark; listeners.forEach((listener) => listener()); });

beforeEach(() => {
  systemDark = false;
  listeners = new Set();
  serverSettings = { preferences: {
    theme: "system", hide_batch_limit_hint: false, cloud_default_locations: {},
  } };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  vi.mocked(fetchAppSettings).mockImplementation(async () => serverSettings);
  vi.mocked(patchAppSettings).mockImplementation(async (patch) => {
    serverSettings = { preferences: { ...serverSettings.preferences, theme: patch.theme ?? serverSettings.preferences.theme } };
    return serverSettings;
  });
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return systemDark; }, media: "(prefers-color-scheme: dark)",
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  }));
});
afterEach(() => { cleanup(); client.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("theme preference", () => {
  it("uses server system preference and follows live system changes", async () => {
    const { result } = renderHook(useThemePreference, { wrapper });
    await waitFor(() => expect(fetchAppSettings).toHaveBeenCalledOnce());
    expect(result.current.preference).toBe("system");
    expect(result.current.mode).toBe("light");
    changeSystem(true);
    expect(result.current.mode).toBe("dark");
    expect(patchAppSettings).not.toHaveBeenCalled();
  });

  it.each(["light", "dark"] as const)("restores server %s preference", async (mode) => {
    serverSettings.preferences.theme = mode;
    const { result } = renderHook(useThemePreference, { wrapper });
    await waitFor(() => expect(result.current.preference).toBe(mode));
    expect(result.current.mode).toBe(mode);
  });

  it("saves explicit appearance and restores it after remount", async () => {
    const { result, unmount } = renderHook(useThemePreference, { wrapper });
    await waitFor(() => expect(fetchAppSettings).toHaveBeenCalledOnce());
    await act(async () => result.current.setPreference("light"));
    changeSystem(true);
    expect(result.current.mode).toBe("light");
    unmount();
    const restored = renderHook(useThemePreference, { wrapper });
    expect(restored.result.current.preference).toBe("light");
    await act(async () => restored.result.current.setPreference("system"));
    expect(restored.result.current.mode).toBe("dark");
    expect(serverSettings.preferences.theme).toBe("system");
  });

  it("rolls back after a save error", async () => {
    const { result } = renderHook(useThemePreference, { wrapper });
    await waitFor(() => expect(fetchAppSettings).toHaveBeenCalledOnce());
    vi.mocked(patchAppSettings).mockRejectedValueOnce(new Error("Offline"));
    await act(async () => { await expect(result.current.setPreference("dark")).rejects.toThrow("Offline"); });
    expect(result.current.preference).toBe("system");
    expect(client.getQueryData<AppSettings>(["app-settings"])).toEqual(serverSettings);
  });

  it("serializes rapid edits and keeps the last successful change", async () => {
    const { result } = renderHook(useThemePreference, { wrapper });
    await waitFor(() => expect(fetchAppSettings).toHaveBeenCalledOnce());
    let finishFirst!: (settings: AppSettings) => void;
    vi.mocked(patchAppSettings).mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }));
    await act(async () => {
      const first = result.current.setPreference("light");
      const second = result.current.setPreference("dark");
      await waitFor(() => expect(patchAppSettings).toHaveBeenCalledOnce());
      serverSettings = { preferences: { ...serverSettings.preferences, theme: "light" } };
      finishFirst(serverSettings);
      await Promise.all([first, second]);
    });
    expect(patchAppSettings).toHaveBeenNthCalledWith(1, { theme: "light" });
    expect(patchAppSettings).toHaveBeenNthCalledWith(2, { theme: "dark" });
    expect(result.current.preference).toBe("dark");
    expect(client.getQueryData<AppSettings>(["app-settings"])).toEqual(serverSettings);
  });

  it("continues queued edits after an earlier save fails", async () => {
    const { result } = renderHook(useThemePreference, { wrapper });
    await waitFor(() => expect(fetchAppSettings).toHaveBeenCalledOnce());
    vi.mocked(patchAppSettings).mockRejectedValueOnce(new Error("Offline"));
    await act(async () => {
      const first = result.current.setPreference("light");
      const second = result.current.setPreference("dark");
      await Promise.all([expect(first).rejects.toThrow("Offline"), second]);
    });
    expect(patchAppSettings).toHaveBeenNthCalledWith(1, { theme: "light" });
    expect(patchAppSettings).toHaveBeenNthCalledWith(2, { theme: "dark" });
    expect(result.current.preference).toBe("dark");
    expect(serverSettings.preferences.theme).toBe("dark");
  });

  it("saves changed fields without waiting for settings to load or requesting them again", async () => {
    const initialSettings = serverSettings;
    let finishLoad!: (settings: AppSettings) => void;
    vi.mocked(fetchAppSettings).mockReturnValueOnce(new Promise((resolve) => { finishLoad = resolve; }));
    const { result } = renderHook(useThemePreference, { wrapper });
    await waitFor(() => expect(fetchAppSettings).toHaveBeenCalledOnce());
    await act(async () => { await result.current.setPreference("dark"); });
    await act(async () => { finishLoad(initialSettings); });
    expect(patchAppSettings).toHaveBeenCalledWith({ theme: "dark" });
    expect(fetchAppSettings).toHaveBeenCalledOnce();
    expect(result.current.preference).toBe("dark");
    expect(client.getQueryData<AppSettings>(["app-settings"])).toEqual(serverSettings);
  });
});
