export interface LocalFolderPick {
  root_path: string;
  selected: boolean;
}

export interface AuthorizationStatus {
  configured: boolean;
  connected: boolean;
  account_id: string | null;
  account_display_name: string | null;
  account_email: string | null;
}

export interface AuthorizationStart {
  authorization_url: string;
}

export interface FileItem {
  id: string;
  name: string;
  path: string;
  parent_path: string;
  is_directory: boolean;
  size: number | null;
  modified_at: string | null;
  location?: StorageLocation | null;
  parent_location?: StorageLocation | null;
  can_rename?: boolean | null;
  mime_type?: string | null;
}

export interface DirectoryBreadcrumb {
  name: string;
  location: StorageLocation;
}

export interface DirectoryListing {
  provider: string;
  path: string;
  parent_path: string | null;
  items: FileItem[];
  storage_id?: string;
  revision?: number;
  location?: StorageLocation;
  parent_location?: StorageLocation | null;
  breadcrumbs?: DirectoryBreadcrumb[] | null;
}

export interface RuleSpec {
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export type ThemePreference = "light" | "dark" | "system";

export interface CloudDefaultLocation {
  account_id: string;
  location: StorageLocation;
}

export interface AppPreferences {
  language: string;
  theme: ThemePreference;
  cloud_default_locations: Record<string, CloudDefaultLocation>;
}

export interface AppSettings {
  preferences: AppPreferences;
}

export interface AppSettingsPatch {
  language?: string;
  theme?: ThemePreference;
  cloud_default_locations?: Record<string, CloudDefaultLocation | null>;
}

export interface RuleDefinition {
  type: string;
  config_schema: Record<string, unknown>;
}

export interface RenameProgress {
  preview_id: string;
  total: number;
  processed: number;
  phase: "waiting" | "validating" | "staging" | "renaming" | "rollback" | "finished" | "failed";
  error: string | null;
}

export interface PreviewItem {
  file_id: string;
  original_name: string;
  new_name: string;
  changed: boolean;
  valid: boolean;
  conflict: boolean;
  error: string | null;
}

export interface PreviewResponse {
  preview_id: string;
  expires_at: string;
  items: PreviewItem[];
  valid: boolean;
}

export interface SingleRenameExecuteRequest {
  operation_id: string;
  location: StorageLocation;
  file_id: string;
  original_name: string;
  target_name: string;
  revision: number;
}

export interface ExecuteItem {
  file_id: string;
  original_name: string;
  new_name: string;
  status: "renamed" | "skipped" | "failed";
  error: string | null;
  error_code?: string | null;
  actual_name?: string | null;
  current_file?: FileItem | null;
}

export interface ExecuteResponse {
  preview_id: string;
  status: "completed" | "partial" | "failed";
  items: ExecuteItem[];
}

export interface SingleRenameExecuteResponse extends Omit<ExecuteResponse, "preview_id"> {
  operation_id: string;
}

export type StorageLocation = { kind: "root" } | { kind: "id" | "path"; value: string };

export interface StorageInfo {
  storage_id: string;
  provider_type: string;
  name: string;
  revision: number;
  busy: boolean;
  has_client_secret?: boolean;
  config: Record<string, unknown>;
  account_id: string | null;
  account_display_name: string | null;
  account_email: string | null;
}

export interface StorageConfigField {
  key: string;
  input_type: "text" | "password" | "directory";
  target: "config" | "client_secret";
  required: boolean;
  nullable: boolean;
}

export interface StorageProviderDefinition {
  provider_type: string;
  config_schema: Record<string, unknown>;
  config_fields: StorageConfigField[];
  icon: "computer" | "cloud";
  locations: Array<StorageLocation["kind"]>;
  can_rename: boolean;
  browser_auth: boolean;
  local_picker: boolean;
}

export interface StorageCreate {
  provider_type: string;
  name: string;
  config: StorageInfo["config"];
  client_secret?: string | null;
}

export interface StorageUpdate {
  name?: string;
  config?: StorageInfo["config"];
  client_secret?: string | null;
}

// 创建任务时复制原始文件信息；重复执行仅更新当前身份和结果，不覆盖 before。
export interface FileSnapshot extends Readonly<FileItem> {
  readonly storageId: string;
}

export interface RenameTaskItem {
  readonly taskItemId: string;
  readonly before: FileSnapshot;
  currentFileId: string;
  after?: Readonly<ExecuteItem>;
}

export interface RenameTask {
  readonly taskId: string;
  readonly contextKey: string;
  readonly storageId: string;
  readonly location: Readonly<StorageLocation>;
  readonly items: readonly RenameTaskItem[];
}
