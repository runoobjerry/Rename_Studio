import type {
  DirectoryListing,
  ExecuteResponse,
  PreviewResponse,
  ProviderInfo,
  RuleDefinition,
  RuleSpec,
  OneDriveAuthStart,
  OneDriveAuthStatus,
  OneDriveSettings,
} from "../types";

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function fetchOneDriveSettings(): Promise<OneDriveSettings> {
  return request("/onedrive/settings");
}

export function updateOneDriveSettings(
  clientId: string,
  clientSecret: string,
): Promise<OneDriveSettings> {
  return request("/onedrive/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
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
