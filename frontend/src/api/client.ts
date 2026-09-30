import type {
  DirectoryListing,
  ExecuteResponse,
  LocalFolderPick,
  LocalSettings,
  PreviewResponse,
  ProviderInfo,
  RuleDefinition,
  RuleSpec,
  OneDriveAuthStart,
  OneDriveAuthStatus,
  OneDriveSettings,
} from "../types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    code: string | null = null,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseError(status: number, body: unknown): ApiError {
  // 代理和非标准错误响应也可能返回 HTML、null 或字段类型错误的 JSON。
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  const message = typeof error.message === "string" && error.message.trim()
    ? error.message
    : `Request failed (${status})`;
  const code = typeof error.code === "string" && error.code.trim() ? error.code : null;
  const details = isRecord(error.details) ? error.details : {};
  return new ApiError(status, message, code, details);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw responseError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function fetchOneDriveSettings(): Promise<OneDriveSettings> {
  return request("/onedrive/settings");
}

export function fetchLocalSettings(): Promise<LocalSettings> {
  return request("/local/settings");
}

export function updateLocalSettings(rootPath: string): Promise<LocalSettings> {
  return request("/local/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root_path: rootPath }),
  });
}

export function pickLocalFolder(): Promise<LocalFolderPick> {
  return request("/local/settings/pick", { method: "POST" });
}

export function updateOneDriveSettings(clientId: string): Promise<OneDriveSettings> {
  return request("/onedrive/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
  });
}

export function clearOneDriveSettings(): Promise<void> {
  return request("/onedrive/settings", { method: "DELETE" });
}

export function fetchOneDriveStatus(): Promise<OneDriveAuthStatus> {
  return request("/onedrive/auth/status");
}

export function startOneDriveAuth(): Promise<OneDriveAuthStart> {
  return request("/onedrive/auth/start", { method: "POST" });
}

export function disconnectOneDriveAccount(): Promise<void> {
  return request("/onedrive/auth/session", { method: "DELETE" });
}

export function fetchProviders(): Promise<ProviderInfo[]> {
  return request("/providers");
}

export function fetchFiles(provider: string, path: string): Promise<DirectoryListing> {
  const query = new URLSearchParams({ provider, path });
  return request(`/files?${query.toString()}`);
}

export function fetchRules(): Promise<RuleDefinition[]> {
  return request("/rules");
}

export function createPreview(
  provider: string,
  path: string,
  fileIds: string[],
  rules: RuleSpec[],
): Promise<PreviewResponse> {
  return request("/rename/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, path, file_ids: fileIds, rules }),
  });
}

export function executePreview(previewId: string): Promise<ExecuteResponse> {
  return request("/rename/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preview_id: previewId }),
  });
}
