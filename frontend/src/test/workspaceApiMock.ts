import { vi } from "vitest";

// 由测试文件的 vi.mock 工厂调用；模块导入本身不替换 API。
export function workspaceApiMock(original: typeof import("../api/client")) {
  return {
    ...original,
    fetchStorages: vi.fn<typeof original.fetchStorages>(),
    fetchStorageProviders: vi.fn<typeof original.fetchStorageProviders>(),
    fetchStorageAuthStatus: vi.fn<typeof original.fetchStorageAuthStatus>(),
    fetchStorageFiles: vi.fn<typeof original.fetchStorageFiles>(),
    pickStorageFolder: vi.fn<typeof original.pickStorageFolder>(),
    fetchAppSettings: vi.fn<typeof original.fetchAppSettings>(),
    patchAppSettings: vi.fn<typeof original.patchAppSettings>(),
    factoryResetAppSettings: vi.fn<typeof original.factoryResetAppSettings>(),
    fetchRules: vi.fn<typeof original.fetchRules>(),
    createStoragePreview: vi.fn<typeof original.createStoragePreview>(),
    executeStorageSingleRename: vi.fn<typeof original.executeStorageSingleRename>(),
    releaseStoragePreview: vi.fn<typeof original.releaseStoragePreview>(),
    executePreview: vi.fn<typeof original.executePreview>(),
    fetchRenameProgress: vi.fn<typeof original.fetchRenameProgress>(),
  };
}
