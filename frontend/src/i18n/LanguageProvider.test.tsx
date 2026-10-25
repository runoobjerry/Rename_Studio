import { deferred } from "../test/deferred";
import { useEffect, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranslation } from "react-i18next";
import * as api from "../api/client";
import type { AppSettings } from "../types";
import { LanguageProvider, useLanguagePreference } from "./LanguageProvider";

vi.mock("../api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/client")>(),
  fetchAppSettings: vi.fn(), patchAppSettings: vi.fn(),
}));

let client: QueryClient;
let server: AppSettings;
let language: ReturnType<typeof useLanguagePreference>;
const mounted = vi.fn();
function Probe() {
  language = useLanguagePreference();
  const { t } = useTranslation("settings");
  useEffect(() => { mounted(); }, []);
  return <span>{t("title")}</span>;
}
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}><LanguageProvider>{children}</LanguageProvider></QueryClientProvider>;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  server = { preferences: { language: "auto", theme: "dark", cloud_default_locations: {} } };
  vi.mocked(api.fetchAppSettings).mockImplementation(async () => server);
  vi.mocked(api.patchAppSettings).mockImplementation(async (patch) => {
    server = { preferences: { ...server.preferences, language: patch.language ?? server.preferences.language } };
    return server;
  });
  mounted.mockClear();
});
afterEach(() => { cleanup(); client.clear(); vi.clearAllMocks(); vi.restoreAllMocks(); });

describe("persisted language preference", () => {
  it("gates the initial UI until saved preferences arrive", async () => {
    const finish = deferred<AppSettings>();
    vi.mocked(api.fetchAppSettings).mockReturnValueOnce(finish.promise);
    render(<Probe />, { wrapper: Wrapper });
    expect(screen.queryByText("设置")).not.toBeInTheDocument();
    expect(mounted).not.toHaveBeenCalled();
    server.preferences.language = "en-US";
    await act(async () => { finish.resolve(server); });
    expect(await screen.findByText("Settings")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("saves only language, preserves other preferences, and restores after remount", async () => {
    const view = render(<Probe />, { wrapper: Wrapper });
    await screen.findByText("设置");
    await act(async () => { await language.setPreference("en-US"); });
    expect(api.patchAppSettings).toHaveBeenCalledWith({ language: "en-US" });
    expect(server.preferences).toEqual({ language: "en-US", theme: "dark", cloud_default_locations: {} });
    expect(document.documentElement.lang).toBe("en-US");
    expect(mounted).toHaveBeenCalledOnce();
    view.unmount();
    client.clear();
    render(<Probe />, { wrapper: Wrapper });
    expect(await screen.findByText("Settings")).toBeInTheDocument();
    expect(language.preference).toBe("en-US");
  });

  it("switches immediately, then rolls back to the persisted choice after failure", async () => {
    render(<Probe />, { wrapper: Wrapper });
    await screen.findByText("设置");
    const fail = deferred<AppSettings>();
    vi.mocked(api.patchAppSettings).mockReturnValueOnce(fail.promise);
    let outcome!: Promise<unknown>;
    act(() => { outcome = language.setPreference("en-US").catch((error: Error) => error.message); });
    expect(screen.getByText("Settings")).toBeInTheDocument();
    await waitFor(() => expect(api.patchAppSettings).toHaveBeenCalledOnce());
    await act(async () => { fail.reject(new Error("Offline")); expect(await outcome).toBe("Offline"); });
    expect(screen.getByText("设置")).toBeInTheDocument();
    expect(language.preference).toBe("auto");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("serializes rapid switches, continues after failure, and keeps the newest draft", async () => {
    render(<Probe />, { wrapper: Wrapper });
    await screen.findByText("设置");
    const fail = deferred<AppSettings>();
    vi.mocked(api.patchAppSettings).mockReturnValueOnce(fail.promise);
    await act(async () => {
      const first = language.setPreference("en-US").catch(() => undefined);
      const second = language.setPreference("zh-CN");
      await waitFor(() => expect(api.patchAppSettings).toHaveBeenCalledOnce());
      fail.reject(new Error("Offline"));
      await Promise.all([first, second]);
    });
    expect(api.patchAppSettings).toHaveBeenNthCalledWith(2, { language: "zh-CN" });
    expect(language.preference).toBe("zh-CN");
    expect(server.preferences.language).toBe("zh-CN");
  });

  it("follows browser changes only in auto and retains unsupported saved identifiers", async () => {
    render(<Probe />, { wrapper: Wrapper });
    await screen.findByText("设置");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
    act(() => { window.dispatchEvent(new Event("languagechange")); });
    expect(screen.getByText("Settings")).toBeInTheDocument();
    await act(async () => { await language.setPreference("zh-CN"); });
    act(() => { window.dispatchEvent(new Event("languagechange")); });
    expect(screen.getByText("设置")).toBeInTheDocument();
    await act(async () => { await language.setPreference("fr-FR"); });
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(server.preferences.language).toBe("fr-FR");
  });
});
