import type {
  AppSettings, AuthorizationStatus, DirectoryListing, FileItem, PreviewResponse,
  StorageInfo, StorageProviderDefinition,
} from "../types";

// 每次返回新对象；文件身份和展示名称可分别覆盖，不推测 Provider 的 ID 语义。
export function fileItem(id: string, overrides: Partial<FileItem> = {}): FileItem {
  return { id, name: id, path: id, parent_path: "", is_directory: false,
    size: 1, modified_at: null, ...overrides };
}

export const listing = (count = 2): DirectoryListing => ({
  provider: "local", path: "", parent_path: null, location: { kind: "root" },
  items: Array.from({ length: count }, (_, index) => fileItem(`file-${index}.txt`)),
});

export const status = (accountId: string | null, connected = true): AuthorizationStatus => ({
  configured: true, connected, account_id: accountId,
  account_display_name: "同名用户", account_email: null,
});

export const appSettings = (): AppSettings => ({ preferences: {
  language: "auto", theme: "system", cloud_default_locations: {},
} });

export const storages = (): StorageInfo[] => [
  { storage_id: "default-local", provider_type: "local", name: "本地文件", revision: 1, busy: false,
    config: { root_path: "C:\\files" }, account_id: null, account_display_name: null, account_email: null },
  { storage_id: "user-onedrive", provider_type: "onedrive", name: "OneDrive", revision: 1, busy: false,
    config: { client_id: "app" }, account_id: "account-a", account_display_name: null, account_email: null },
];

export const providerDefinitions = (): StorageProviderDefinition[] => [
  { provider_type: "local", locations: ["root", "path", "id"], can_rename: true,
    browser_auth: false, local_picker: true, config_schema: {}, icon: "computer",
    config_fields: [{ key: "root_path", input_type: "directory", target: "config", required: true, nullable: false }] },
  { provider_type: "onedrive", locations: ["root", "path", "id"], can_rename: true,
    browser_auth: true, local_picker: false, config_schema: {}, icon: "cloud",
    config_fields: [{ key: "client_id", input_type: "text", target: "config", required: false, nullable: true }] },
];

export function previewResponse(ids: string[], previewId = "task-preview"): PreviewResponse {
  return { preview_id: previewId, expires_at: "2099-01-01T00:00:00Z", valid: true,
    items: ids.map((id) => ({ file_id: id, original_name: id, new_name: `renamed-${id}`,
      changed: true, valid: true, conflict: false, error: null })) };
}
