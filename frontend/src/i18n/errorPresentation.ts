export interface PresentationError {
  message: string;
  code?: string | null;
  details?: Record<string, unknown>;
  operation?: "read" | "write";
  status?: number;
}

export type ErrorPresentationContext = "directory" | "settings" | "connection" | "singleRename";
type ErrorKey = `errors:${string}` | "files:verification.required";

export interface ErrorPresentation {
  key: ErrorKey;
  values?: Record<string, string | number>;
}

const codeKeys = new Map<string, ErrorKey>([
  ["APPLICATION_ERROR", "errors:operationUnavailable"],
  ["INTERNAL_ERROR", "errors:operationUnavailable"],
  ["NOT_FOUND", "errors:itemMissing"],
  ["PROVIDER_ERROR", "errors:storageUnavailable"],
  ["AUTHENTICATION_ERROR", "errors:authorizationUnavailable"],
  ["RATE_LIMIT_ERROR", "errors:tooManyRequests"],
  ["PERMISSION_DENIED", "errors:renamePermissionDenied"],
  ["VALIDATION_ERROR", "errors:operationInputInvalid"],
  ["REQUEST_VALIDATION_ERROR", "errors:inputInvalid"],
  ["RULE_CONFIGURATION_ERROR", "errors:ruleSettingsInvalid"],
  ["RENAME_CONFLICT", "errors:nameOccupied"],
  ["PREVIEW_EXPIRED", "errors:previewExpired"],
  ["PREVIEW_NOT_FOUND", "errors:previewMissing"],
  ["STORAGE_BUSY", "errors:connectionBusy"],
  ["STORAGE_CONNECTION_CHANGED", "errors:connectionChanged"],
  ["STORAGE_ACCOUNT_ALREADY_CONNECTED", "errors:accountAlreadyConnected"],
]);

interface ReasonPresentation {
  code: string;
  key: ErrorKey;
  params?: readonly string[];
}

const reasonPresentations = new Map<string, ReasonPresentation>([
  ["SOURCE_CHANGED", { code: "RENAME_CONFLICT", key: "errors:fileChanged" }],
  ["RENAME_UNSUPPORTED", { code: "VALIDATION_ERROR", key: "errors:renameUnsupported" }],
  ["ITEM_RENAME_UNAVAILABLE", { code: "VALIDATION_ERROR", key: "errors:itemRenameUnavailable" }],
  ["CONNECTION_NOT_FOUND", { code: "NOT_FOUND", key: "errors:connectionMissing" }],
  ["ACCOUNT_NOT_CONNECTED", { code: "AUTHENTICATION_ERROR", key: "errors:accountDisconnected" }],
  ["AUTHORIZATION_EXPIRED", { code: "AUTHENTICATION_ERROR", key: "errors:authorizationExpired" }],
  ["LOCATION_OUTSIDE_ROOT", { code: "VALIDATION_ERROR", key: "errors:outsideRoot" }],
  ["SYMBOLIC_LINK_UNSUPPORTED", { code: "VALIDATION_ERROR", key: "errors:symbolicLink" }],
  ["DEFAULT_CONNECTION_DELETE_FORBIDDEN", { code: "VALIDATION_ERROR", key: "errors:defaultConnection" }],
  ["PREVIEW_DUPLICATE_FILE_IDS", { code: "VALIDATION_ERROR", key: "errors:selectionDuplicated" }],
  ["PREVIEW_ITEMS_NOT_IN_DIRECTORY", { code: "VALIDATION_ERROR", key: "errors:selectionOutsideDirectory" }],
  ["NAME_EMPTY", { code: "VALIDATION_ERROR", key: "errors:nameEmpty" }],
  ["NAME_NULL_CHARACTER", { code: "VALIDATION_ERROR", key: "errors:nameNull" }],
  ["NAME_DOT_SEGMENT", { code: "VALIDATION_ERROR", key: "errors:nameDots" }],
  ["NAME_INVALID_CHARACTERS", { code: "VALIDATION_ERROR", key: "errors:nameCharacters", params: ["characters", "control_characters"] }],
  ["NAME_INVALID_ENDING", { code: "VALIDATION_ERROR", key: "errors:nameEnding" }],
  ["NAME_RESERVED_WINDOWS", { code: "VALIDATION_ERROR", key: "errors:nameReserved" }],
  ["NAME_TOO_LONG", { code: "VALIDATION_ERROR", key: "errors:nameLength", params: ["max_length"] }],
  ["ONEDRIVE_PATH_TOO_LONG", { code: "VALIDATION_ERROR", key: "errors:pathLength", params: ["max_length"] }],
  ["ONEDRIVE_NAME_INVALID_PREFIX", { code: "VALIDATION_ERROR", key: "errors:oneDriveStart", params: ["prefixes"] }],
  ["ONEDRIVE_FOLDER_INVALID_PREFIX", { code: "VALIDATION_ERROR", key: "errors:oneDriveFolderStart", params: ["prefixes"] }],
  ["NAME_RESERVED_ONEDRIVE", { code: "VALIDATION_ERROR", key: "errors:oneDriveReserved" }],
  ["NAME_RESERVED_IN_ROOT", { code: "VALIDATION_ERROR", key: "errors:oneDriveForms", params: ["name"] }],
  ["GOOGLE_DRIVE_SHORTCUT_RENAME_UNSUPPORTED", { code: "VALIDATION_ERROR", key: "errors:googleShortcut" }],
  ["ROOT_RENAME_UNSUPPORTED", { code: "VALIDATION_ERROR", key: "errors:rootRename" }],
]);

// 只覆盖通用类别；精确原因和写入结果确定性始终优先。
const contextKeys: Record<ErrorPresentationContext, ReadonlyMap<string, ErrorKey>> = {
  directory: new Map([
    ["NOT_FOUND", "errors:directoryMissing"],
    ["VALIDATION_ERROR", "errors:locationInvalid"],
    ["PERMISSION_DENIED", "errors:accessDenied"],
  ]),
  settings: new Map([
    ["NOT_FOUND", "errors:settingsUnavailable"],
    ["PROVIDER_ERROR", "errors:settingsUnavailable"],
    ["VALIDATION_ERROR", "errors:inputInvalid"],
    ["PERMISSION_DENIED", "errors:accessDenied"],
  ]),
  connection: new Map([
    ["NOT_FOUND", "errors:connectionMissing"],
    ["PROVIDER_ERROR", "errors:connectionUnavailable"],
    ["VALIDATION_ERROR", "errors:inputInvalid"],
    ["PERMISSION_DENIED", "errors:accessDenied"],
  ]),
  singleRename: new Map([
    ["STORAGE_CONNECTION_CHANGED", "errors:connectionRefreshRequired"],
  ]),
};

function presentationValues(params: unknown, names: readonly string[]): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  if (!params || typeof params !== "object" || Array.isArray(params)) return values;
  for (const name of names) {
    const value = (params as Record<string, unknown>)[name];
    if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) values[name] = value;
    else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      values[name] = value.map((entry: string) => name === "prefixes" ? JSON.stringify(entry) : entry).join(" ");
    }
  }
  return values;
}

function requestValidationKey(errors: unknown): ErrorKey | undefined {
  if (!Array.isArray(errors)) return;
  for (const entry of errors) {
    if (typeof entry !== "object" || entry === null || !Array.isArray(entry.loc)) continue;
    const field = entry.loc[entry.loc.length - 1];
    if (field === "name" && (entry.type === "string_too_short" || entry.type === "missing")) return "errors:connectionNameEmpty";
    if (field === "name" && entry.type === "string_too_long") return "errors:connectionNameLength";
    if ((field === "target_name" || field === "new_name") && (entry.type === "string_too_short" || entry.type === "missing")) return "errors:nameEmpty";
    if (field === "client_secret") return "errors:clientSecret";
  }
}

export function resolveErrorPresentation(error: PresentationError, context?: ErrorPresentationContext): ErrorPresentation {
  if (error.code === "RENAME_OUTCOME_UNKNOWN") return { key: "files:verification.required" };
  // 未收到可靠写入响应时，任何场景都不能将提示降级为直接重试。
  if (error.operation === "write" && error.details?.execution_started !== false &&
    (error.status === 0 || (error.status ?? 0) >= 500)) return { key: "errors:writeUnknown" };

  const reason = error.details?.reason;
  const mapping = typeof reason === "string" ? reasonPresentations.get(reason) : undefined;
  if (mapping && error.code === mapping.code) {
    return mapping.params ? { key: mapping.key, values: presentationValues(error.details?.params, mapping.params) }
      : { key: mapping.key };
  }
  if (error.code === "REQUEST_VALIDATION_ERROR") {
    const key = requestValidationKey(error.details?.errors);
    if (key) return { key };
  }
  const key = error.code ? (context && contextKeys[context].get(error.code)) || codeKeys.get(error.code) : undefined;
  return { key: key ?? (error.operation === "write" ? "errors:operationUnavailable" : "errors:readUnavailable") };
}
