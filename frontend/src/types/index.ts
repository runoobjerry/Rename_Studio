export interface ProviderInfo {
  id: string;
  name: string;
  writable: boolean;
}

export interface LocalSettings {
  root_path: string;
}

export interface LocalFolderPick extends LocalSettings {
  selected: boolean;
}

export interface OneDriveSettings {
  configured: boolean;
  client_id: string | null;
  redirect_uri: string;
}

export interface OneDriveAuthStatus {
  configured: boolean;
  connected: boolean;
  account_id: string | null;
  account_display_name: string | null;
  account_email: string | null;
}

export interface OneDriveAuthStart {
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
}

export interface DirectoryListing {
  provider: string;
  path: string;
  parent_path: string | null;
  items: FileItem[];
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
}

export interface ExecuteResponse {
  preview_id: string;
  status: "completed" | "partial" | "failed";
  items: ExecuteItem[];
}
