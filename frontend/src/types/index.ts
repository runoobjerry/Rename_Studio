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
}

export interface RuleSpec {
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface RuleDefinition {
  type: string;
  name: string;
  description: string;
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

export interface ExecuteItem {
  file_id: string;
  original_name: string;
  new_name: string;
  status: "renamed" | "skipped" | "failed";
  error: string | null;
  error_code?: string | null;
  actual_name?: string | null;
}

export interface ExecuteResponse {
  preview_id: string;
  status: "completed" | "partial" | "failed";
  items: ExecuteItem[];
}

export type StorageLocation = { kind: "root" } | { kind: "id" | "path"; value: string };

export interface StorageInfo {
  storage_id: string;
  provider_type: string;
  name: string;
  revision: number;
  busy: boolean;
  config: { root_path?: string; client_id?: string | null };
  account_id: string | null;
  account_display_name: string | null;
  account_email: string | null;
}

export interface StorageProviderDefinition {
  provider_type: string;
  name: string;
  config_schema: Record<string, unknown>;
  locations: Array<StorageLocation["kind"]>;
  can_rename: boolean;
  browser_auth: boolean;
  local_picker: boolean;
}

export interface StorageCreate {
  provider_type: string;
  name: string;
  config: StorageInfo["config"];
}

export interface StorageUpdate {
  name?: string;
  config?: StorageInfo["config"];
}
