export interface ProviderInfo {
  id: string;
  name: string;
  writable: boolean;
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
  items: PreviewItem[];
  valid: boolean;
}
