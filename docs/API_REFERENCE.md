# API Reference

Frontend-facing contract verified against `backend/app/api/router.py`, Pydantic schemas, and `frontend/src/api/client.ts`.

## Conventions

- Backend routes have no `/api` prefix. Vite proxies frontend `/api/*` requests to backend `/*` in development.
- JSON uses `snake_case`; datetimes are ISO 8601 strings; HTTP 204 has no body.
- `provider` is an opaque string. Registered values are currently `local` and `onedrive`.
- `file_id` is provider-owned and must be treated as opaque. Local IDs are relative paths and change after rename; OneDrive IDs are Graph item IDs.
- `/files` has no pagination, search, sort, or filter parameters. OneDrive Graph pages are aggregated by the backend before one response is returned.

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
| 502 | `PROVIDER_ERROR` | Local filesystem, Graph, identity service, or local settings persistence failed. |
| 500 | `INTERNAL_ERROR` | Unexpected error; `details.request_id` identifies the server log entry. |

## Shared Types

```ts
interface ProviderInfo {
  id: string;
  name: string;
  writable: boolean;
}

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

## Providers and Files

### `GET /providers`

- Request: none.
- Response: `ProviderInfo[]`; currently Local Files and OneDrive Personal, both writable.
- Errors: common 500.

### `GET /files`

- Query: `provider: string = "local"`, `path: string = ""`.
- Response: `DirectoryListing`. Items are direct children, directories first, then case-insensitive name order.
- Errors: 422 unknown provider or invalid `.`/`..` path; 404 missing directory; 401 OneDrive auth; 429 Graph rate limit; 502 provider failure.
- Selection is frontend state, not an API. Selected files/folders must share one direct parent and their IDs are sent to Preview.

## Local Settings

### `GET /local/settings`

- Request: none.
- Response: `{ root_path: string }`, an absolute path on the backend machine.

### `PUT /local/settings`

- Body: `{ root_path: string }`, trimmed, length 1–4096, existing backend-machine directory.
- Response: `{ root_path: string }` with the resolved absolute path.
- Errors: 422 invalid/non-directory path; 502 persistence failure.
- Frontend behavior after success: return to path `""`, clear selection/preview/execution, and refresh Local Files.

### `POST /local/settings/pick`

- Request: no body.
- Response: `{ root_path: string; selected: boolean }`.
- `selected: false` means the native picker was cancelled and the root did not change.
- Errors: 422 directory validation; 502 unavailable desktop picker or persistence failure.
- The picker runs on the backend machine; retain manual path input for remote/headless environments.

## OneDrive Settings and Authentication

### `GET /onedrive/settings`

- Response: `{ configured: boolean; client_id: string | null; redirect_uri: string }`.
- Tokens and client secrets are never returned.

### `PUT /onedrive/settings`

- Body: `{ client_id: string }`, trimmed, length 1–200.
- Response: same as GET settings.
- Errors: 422 invalid value; 502 persistence failure.
- Changing App ID clears the previous account authorization; saving the same ID preserves it.

### `DELETE /onedrive/settings`

- Response: 204.
- Deletes App ID, refresh token, account profile, and connection state.
- Errors: 502 local deletion failure.

### `GET /onedrive/auth/status`

- Response:

```ts
{
  configured: boolean;
  connected: boolean;
  account_display_name: string | null;
  account_email: string | null;
}
```

- A persisted refresh token can initially report connected after backend restart; the next Graph request performs real refresh/validation.

### `POST /onedrive/auth/start`

- Request: no body.
- Response: `{ authorization_url: string }`.
- Errors: 422 App ID not configured; 502 local state failure.
- Starting authorization removes the previous account token even if the popup is later cancelled.

### `GET /auth/onedrive/callback`

- Browser callback, not JSON API. Do not use the Vite `/api` prefix.
- Query: success uses `code` and `state`; failure may use `error` and `error_description`.
- Response: HTML, HTTP 200 on success or 400 on failure.
- Posts to configured frontend origin:

```ts
{ type: "onedrive-auth"; status: "connected" | "failed"; message: string }
```

- Frontend must validate `event.origin`.

### `DELETE /onedrive/auth/session`

- Response: 204.
- Deletes refresh token and account profile while preserving App ID.
- Errors: 502 local persistence failure.

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
| `padding` | Required `mode: "number" | "text"`, `length: 1..255`; `fill_character` defaults to `_` and is one character; `side` defaults to `left`. |
| `replace` | Required `search: 1..255`; `replacement` max 255, default empty; `occurrence: all | first | last`; `case_sensitive=true`; `whole_word=false`; `ignore_extension=true`. |
| `remove` | Same matching fields as replace, without `replacement`. |
| `insert` | Required `text: 1..255`; `position: prefix | suffix | index | before_text | after_text`; `index: 1..255`; `from_right=false`; text-relative positions require non-empty `anchor` (max 255). |

Rules execute in array order; disabled rules are skipped. The frontend only renders fields for these four known types.

## Rename Preview

### `POST /rename/preview`

- Body:

```ts
{
  provider?: string;       // default "local"
  path?: string | null;    // frontend sends DirectoryListing.path
  file_ids: string[];      // at least one, no duplicates
  rules?: RuleSpec[];      // default []
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
- Errors: 422 empty/duplicate/cross-directory/out-of-path/root selection, invalid path, or rule config; 404 missing item/directory; provider errors as above.
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
  }>;
}
```

- Errors: 404 missing/already-consumed preview; 409 expired or changed source state; 422 invalid preview; provider errors during revalidation.
- The backend revalidates before mutation, consumes the preview before real execution, and will not execute it twice.
- Item failures can be returned in an HTTP 200 response with overall `partial` or `failed`; inspect response status and every item.

## Not Implemented

- RuleSet API or persistence.
- History, Undo, or Redo API/persistence.
- Server-side file selection, pagination, search, sorting, or filtering.

## Known API inconsistency

No route/schema/client field mismatch was found during this audit. The current frontend client limitation is that it discards structured error status/code/details and exposes only `message`; this is tracked in `UI_TODO.md` and does not require an API change.

