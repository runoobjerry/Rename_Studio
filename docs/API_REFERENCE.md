# API Reference

Frontend-facing contract verified against `backend/app/api/router.py`, `backend/app/api/storage_router.py`, Pydantic schemas, and `frontend/src/api/client.ts`.

## Conventions

- Backend routes have no `/api` prefix. Vite proxies frontend `/api/*` requests to backend `/*` in development.
- JSON uses `snake_case`; datetimes are ISO 8601 strings; HTTP 204 has no body.
- `provider_type` identifies the driver (`local` or `onedrive`); `storage_id` identifies the independent connection. DirectoryListing.provider remains the driver type for display.
- Storage APIs use `storage_id` and `location`. Only `default-local` is created automatically; cloud connections are added by the user.
- `file_id` is provider-owned and must be treated as opaque. Local IDs are relative paths and change after rename; OneDrive IDs are Graph item IDs.
- The connection-scoped directory API has no pagination, search, sort, or filter parameters. OneDrive Graph pages are aggregated by the backend before one response is returned.

Except for the OAuth HTML callback, application errors use:

```ts
{
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}
```

Common errors:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `AUTHENTICATION_ERROR` | OneDrive is disconnected or authorization refresh failed. |
| 404 | `NOT_FOUND`, `PREVIEW_NOT_FOUND` | Item/directory missing, or preview missing/already consumed. |
| 409 | `RENAME_CONFLICT`, `PREVIEW_EXPIRED` | Rename conflict, expired preview, or changed source state. |
| 422 | `REQUEST_VALIDATION_ERROR` | Pydantic request validation failed. |
| 422 | `VALIDATION_ERROR`, `RULE_CONFIGURATION_ERROR` | Path, selection, name, or rule validation failed. |
| 429 | `RATE_LIMIT_ERROR` | Graph throttling remained after retry. |
| 502 | `PROVIDER_ERROR` | Local filesystem, Graph, identity service, or connection state persistence failed. |
| 500 | `INTERNAL_ERROR` | Unexpected error; `details.request_id` identifies the server log entry. |

## Shared Types

```ts
interface FileItem {
  id: string;
  name: string;
  path: string;
  parent_path: string;
  is_directory: boolean;
  size: number | null;
  modified_at: string | null;
}

interface DirectoryListing {
  provider: string;
  path: string;
  parent_path: string | null;
  items: FileItem[];
}

interface RuleSpec {
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

interface PreviewItem {
  file_id: string;
  original_name: string;
  new_name: string;
  changed: boolean;
  valid: boolean;
  conflict: boolean;
  error: string | null;
}
```

`parent_path === null` only for a provider root listing. Directory `size` is `null`. `conflict` is only one invalid-state category; UI must prefer the item `error` text.

## Rules

### `GET /rules`

- Response:

```ts
Array<{
  type: string;
  name: string;
  description: string;
  config_schema: Record<string, unknown>;
}>
```

Supported rule configs:

| Type | Config |
| --- | --- |
| `padding` | Required `mode: "number" | "text"`, `length: 1..255`; `fill_character` defaults to `_`, max one character; empty text fill skips the rule; `side` defaults to `left`. |
| `replace` | Required `search: 0..255`; empty search skips the rule. `replacement` max 255, default empty (deletes matches); `occurrence: all | first | last`; `case_sensitive=true`; `whole_word=false`; `ignore_extension=true`. |
| `remove` | Same matching fields as replace, without `replacement`. |
| `insert` | Required `text: 0..255`; empty text skips the rule. `position: prefix | suffix | index | before_text | after_text`; `index: 1..255`; `from_right=false`; text-relative positions with empty `anchor` skip the rule (max 255). |

Rules execute in array order; disabled rules are skipped. The frontend only renders fields for these four known types.

Empty means exactly `""`; whitespace remains meaningful text. Skipped rules preserve the current filename and allow later rules to run. Missing required fields, wrong types, invalid enum values and out-of-range lengths still return `RULE_CONFIGURATION_ERROR`.

## Rename Preview

### `POST /storages/{storage_id}/rename/preview`

- Body:

```ts
{
  location?: StorageLocation; // default root; use backend-returned locations for navigation
  file_ids: string[];      // 1..1000 items, no duplicates
  rules?: RuleSpec[];      // default [], at most 20 rules
}
```

- Response:

```ts
{
  preview_id: string;
  expires_at: string;
  items: PreviewItem[];
  valid: boolean;
}
```

- No files are modified. Unchanged items remain in `items`; `valid` is true only when every item is valid.
- Errors: 422 more than 1000 files/more than 20 rules/empty/duplicate/cross-directory/out-of-path/root selection, invalid path, or rule config; 404 missing item/directory; provider errors as above.
- Preview snapshots live in the current backend process for 10 minutes. A backend restart invalidates them.

## Rename Execute

### `POST /rename/execute`

- Body: `{ preview_id: string }`, non-empty.
- Response:

```ts
{
  preview_id: string;
  status: "completed" | "partial" | "failed";
  items: Array<{
    file_id: string;
    original_name: string;
    new_name: string;
    status: "renamed" | "skipped" | "failed";
    error: string | null;
    error_code?: string | null;
    actual_name?: string | null;
    current_file?: FileItem | null; // Provider-confirmed metadata after success or successful rollback
  }>;
}
```

- Errors: 404 missing/already-consumed preview; 409 expired or changed source state; 422 invalid preview; provider errors during revalidation.
- The backend revalidates before mutation, consumes the preview before real execution, and will not execute it twice.
- Item failures can be returned in an HTTP 200 response with overall `partial` or `failed`; inspect response status and every item.

## Rename Execution Progress

### `GET /rename/progress/{preview_id}`

- Read-only progress query; it does not start, consume, cancel, or retry an execution. POST `/rename/execute` remains a single request returning the existing final response.
- Response:

```ts
{
  preview_id: string;
  total: number;     // changed preview items only, excludes unchanged/skipped items
  processed: number; // finalized items, including failures; not a success count
  phase: "waiting" | "validating" | "staging" | "renaming" | "rollback" | "finished" | "failed";
  error: string | null;
}
```

- Before execution, a valid preview returns `waiting` with zero processed. Execution publishes real counts after batches sized by the provider (currently 20 for Local/OneDrive). Staging is not counted; dependent direct renames are counted only after their phase succeeds, and final staged items only after final rename/rollback handling.
- `finished` means the execution response is ready, including `partial`/`failed` responses. All items finalized as failed/not attempted after batch abort are counted as processed. 100% does not mean all renames succeeded; consult POST response and per-item results.
- Request-level failure/cancellation reports `failed` and retains the known count; validation failure stays at zero. Unexpected errors use a generic message without exposing internal exception details.
- Progress is process-local, uses the same singleton execution service, and is retained for 10 minutes after termination. Restart, expiry, or an unknown/consumed preview without a retained record yields 404; an expired unexecuted preview yields 409. This does not provide durable jobs, history, or reconnect/resume semantics.
- Frontend polls every 500ms only while POST is pending; fast batches may appear as 0% → 100%. Polling failure never triggers another execute request.

## Not Implemented

- RuleSet API or persistence.
- History, Undo, or Redo API/persistence.
- Server-side file selection, pagination, search, sorting, or filtering.

## Multiple Storage Connections

The backend registers only Local and OneDrive. Provider types describe implementations; storage IDs identify independent configuration/account instances. Google Drive is not implemented.

```ts
type StorageLocation = { kind: "root" } | { kind: "id" | "path"; value: string };
interface StorageInfo {
  storage_id: string;
  provider_type: string;
  name: string;
  config: { root_path?: string; client_id?: string | null };
  revision: number;
  busy: boolean;
  account_id: string | null;
  account_display_name: string | null;
  account_email: string | null;
}
```

Storage connection create/update requests reject the removed `enabled` field. The UI displays authorization status instead of an enable/disable control. Credentials are never included in StorageInfo. Local config requires an existing backend-machine `root_path`; OneDrive config has nullable `client_id`. Unsupported config fields are rejected. IDs are opaque, paths are normalized at the input boundary, and root locations do not carry a value.

| Method / route | Request | Response |
| --- | --- | --- |
| `GET /storage-providers` | none | Definitions: provider_type, name, config_schema, locations, can_rename, browser_auth, local_picker |
| `GET /storages` | none | `StorageInfo[]` |
| `POST /storages` | `{provider_type,name,config}` | 201 `StorageInfo` |
| `GET /storages/{storage_id}` | none | `StorageInfo` |
| `PUT /storages/{storage_id}` | `{name?:string,config?:object}` | `StorageInfo`; config replaces the previous config when supplied |
| `DELETE /storages/{storage_id}` | none | 204; only default-local cannot be deleted |
| `POST /storages/{storage_id}/files/list` | `{location?:StorageLocation}`; default root | Extended `DirectoryListing` |
| `POST /storages/{storage_id}/local/pick` | none | `{root_path,selected}`; Local connections only |
| `GET /storages/{storage_id}/auth/status` | none | `{configured,connected,account_id,account_display_name,account_email}`; profile fields are nullable |
| `POST /storages/{storage_id}/auth/start` | none | `{authorization_url,redirect_uri}` |
| `DELETE /storages/{storage_id}/auth/session` | none | 204; preserves client configuration |
| `POST /storages/{storage_id}/rename/preview` | `{location?:StorageLocation,file_ids,rules?:RuleSpec[]}` | Existing `RenamePreviewResponse` |

Extended listings add `storage_id`, `revision`, `location`, `parent_location`; items add `location`, `parent_location`, `can_rename`. Display path fields remain available. Root listing parent_location is null. Unknown permission is null, not a guarantee that remote writes will succeed. Folder navigation uses item.location; parent navigation uses listing.parent_location.

Config/account changes invalidate old previews with `STORAGE_CONNECTION_CHANGED` (409); normal token rotation does not change revision. Active rename connections reject configuration, authorization and deletion with `STORAGE_BUSY` (409). Unknown connections return 404; invalid locations or configuration return 422. Complete listing failures return provider errors rather than partial directories.

`GET /auth/storage/callback` is an HTML callback with code/state/error query parameters. Configure `STORAGE_REDIRECT_URI` in the Microsoft application. OAuth state is single use, expiring, and bound to connection/revision. It posts:

```ts
{ type: "storage-auth"; storage_id: string | null; status: "connected" | "failed"; message: string }
```

The frontend validates the callback origin from redirect_uri, popup window source, message shape and storage_id.

Execute still accepts only preview_id and progress polling remains read-only. Result items optionally include error_code/actual_name/current_file. current_file preserves Provider-confirmed identity after successful rename or rollback, including changed Local path IDs; file_id remains the original request ID. Null does not mean a write succeeded or failed. Preview requests are limited to 1000 files and 20 rules (including disabled rules); execute also checks the snapshot size. Directory loading and overall UI selection remain unlimited. `RENAME_OUTCOME_UNKNOWN` means a write could have happened but its current state could not be verified; actual_name is null. Known successful writes are not replayed after a missing response. Rollback errors report remaining names when they can be confirmed. Existing completed/partial/failed and renamed/skipped/failed enums retain their meaning.

## Known API inconsistency

No route/schema/client field mismatch was found during this audit. The frontend client now exposes HTTP failures as `ApiError`, preserving `status`, `code`, `message`, and `details`. Non-standard responses retain the HTTP status with a fallback message, null code, and empty details. Network failures remain their original errors. Existing UI consumers can continue reading `error.message`; dedicated code-based recovery remains tracked in `UI_TODO.md`.


## Removed API contracts

The former provider/path browsing, Local/OneDrive settings, provider-specific authentication callback, and `/rename/preview` endpoints are removed. They are not redirected or translated. `/rename/execute`, `/rename/progress/{preview_id}`, `/rules` and `/health` remain shared endpoints. Storage IDs have no `local`/`onedrive` aliases.
