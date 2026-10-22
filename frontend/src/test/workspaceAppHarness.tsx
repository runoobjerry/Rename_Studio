import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, vi } from "vitest";
import * as api from "../api/client";
import WorkspaceApp from "../WorkspaceApp";
import { readDefaultCloudLocation } from "../features/files/defaultCloudLocation";
import type { AppSettings, StorageLocation } from "../types";
import { client, installWorkspaceTestHooks, serverSettings } from "./workspaceHarness";

export function installWorkspaceAppTestHooks() {
  installWorkspaceTestHooks();
  beforeEach(() => {
    // 页面测试显式使用空目录；需要文件的场景自行提供。
    vi.mocked(api.fetchStorageFiles).mockImplementation(async (provider, location) => ({
      provider, location, path: location.kind === "root" ? "" : location.value,
      parent_path: location.kind === "root" ? null : "", items: [],
    }));
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { x: 0, y: 0, top: 0, left: 0, bottom: 30, right: 1000,
        width: this.tagName === "BUTTON" ? 80 : 1000, height: 30, toJSON: () => ({}) };
    });
  });
}

export const renderWorkspace = () => render(<QueryClientProvider client={client}><WorkspaceApp /></QueryClientProvider>);

export function seedCloud(storageId: string, accountId: string, location: StorageLocation) {
  serverSettings.preferences.cloud_default_locations[storageId] = { account_id: accountId, location };
}

export function savedCloud(storageId: string, accountId: string) {
  const settings = client.getQueryData<AppSettings>(["app-settings"]);
  expect(settings).toBeDefined();
  return readDefaultCloudLocation(settings!.preferences, storageId, accountId);
}
