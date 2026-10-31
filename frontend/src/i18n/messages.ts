import type { TFunction } from "i18next";
import { i18n } from "./index";

export interface LocalizedMessage {
  key: string;
  values?: Record<string, string | number>;
  error?: Error;
}

export type NotificationMessage = string | LocalizedMessage | Error;

const translatedCodes = [
  "APPLICATION_ERROR", "NOT_FOUND", "PROVIDER_ERROR", "AUTHENTICATION_ERROR", "RATE_LIMIT_ERROR",
  "PERMISSION_DENIED", "VALIDATION_ERROR", "REQUEST_VALIDATION_ERROR", "RULE_CONFIGURATION_ERROR",
  "RENAME_CONFLICT", "PREVIEW_EXPIRED", "PREVIEW_NOT_FOUND", "STORAGE_BUSY",
  "STORAGE_CONNECTION_CHANGED", "RENAME_OUTCOME_UNKNOWN", "INTERNAL_ERROR",
];

const operationReasons: Record<string, { code: string; key: string }> = {
  RENAME_UNSUPPORTED: { code: "VALIDATION_ERROR", key: "renameUnsupported" },
  ITEM_RENAME_UNAVAILABLE: { code: "VALIDATION_ERROR", key: "itemRenameUnavailable" },
  CONNECTION_NOT_FOUND: { code: "NOT_FOUND", key: "connectionMissing" },
  ACCOUNT_NOT_CONNECTED: { code: "AUTHENTICATION_ERROR", key: "accountDisconnected" },
  AUTHORIZATION_EXPIRED: { code: "AUTHENTICATION_ERROR", key: "authorizationExpired" },
  LOCATION_OUTSIDE_ROOT: { code: "VALIDATION_ERROR", key: "outsideRoot" },
  SYMBOLIC_LINK_UNSUPPORTED: { code: "VALIDATION_ERROR", key: "symbolicLink" },
  DEFAULT_CONNECTION_DELETE_FORBIDDEN: { code: "VALIDATION_ERROR", key: "defaultConnection" },
};

const nameValidationReasons: Record<string, string> = {
  NAME_EMPTY: "nameEmpty",
  NAME_NULL_CHARACTER: "nameNull",
  NAME_DOT_SEGMENT: "nameDots",
  NAME_INVALID_CHARACTERS: "nameCharacters",
  NAME_INVALID_ENDING: "nameEnding",
  NAME_RESERVED_WINDOWS: "nameReserved",
  NAME_TOO_LONG: "nameLength",
  ONEDRIVE_PATH_TOO_LONG: "pathLength",
  ONEDRIVE_NAME_INVALID_PREFIX: "oneDriveStart",
  ONEDRIVE_FOLDER_INVALID_PREFIX: "oneDriveFolderStart",
  NAME_RESERVED_ONEDRIVE: "oneDriveReserved",
  NAME_RESERVED_IN_ROOT: "oneDriveForms",
  GOOGLE_DRIVE_SHORTCUT_RENAME_UNSUPPORTED: "googleShortcut",
  ROOT_RENAME_UNSUPPORTED: "rootRename",
};

const translatedValidationReasons = [
  "PREVIEW_DUPLICATE_FILE_IDS", "PREVIEW_ITEMS_NOT_IN_DIRECTORY",
];

export function errorMessage(error: { message: string; code?: string | null; details?: Record<string, unknown>; operation?: "read" | "write"; status?: number }, t: TFunction = i18n.t): string {
  if (error.code === "RENAME_OUTCOME_UNKNOWN") return t("files:verification.required");
  // 写入请求没有得到可靠响应时不提供重试建议；重命名流程另有专用核对提示。
  if (error.operation === "write" && error.details?.execution_started !== false &&
    (error.status === 0 || (error.status ?? 0) >= 500)) return t("errors:writeUnknown");
  const reason = error.details?.reason;
  if (typeof reason === "string" && Object.hasOwn(operationReasons, reason)) {
    const mapping = operationReasons[reason];
    if (error.code === mapping.code) return t(`errors:reasons.${mapping.key}`);
  }
  if (error.code === "VALIDATION_ERROR" && typeof reason === "string" && Object.hasOwn(nameValidationReasons, reason)) {
    const params = error.details?.params;
    // 参数只做显示格式化，名称限制和数值均由实际校验方提供。
    const values: Record<string, unknown> = params && typeof params === "object" && !Array.isArray(params)
      ? Object.fromEntries(Object.entries(params).map(([key, value]) => [key,
        Array.isArray(value) ? value.map((entry) => key === "prefixes" ? JSON.stringify(entry) : entry).join(" ") : value,
      ])) : {};
    return t(`errors:reasons.${nameValidationReasons[reason]}`, values);
  }
  if (error.code === "VALIDATION_ERROR" && typeof reason === "string" && translatedValidationReasons.includes(reason)) {
    return t(`errors:validationReasons.${reason}`);
  }
  if (error.code === "RENAME_CONFLICT" && error.details?.graph_status === 412) {
    return t("errors:reasons.fileChanged");
  }
  if (error.code === "REQUEST_VALIDATION_ERROR" && Array.isArray(error.details?.errors)) {
    for (const entry of error.details.errors) {
      if (typeof entry !== "object" || entry === null || !Array.isArray(entry.loc)) continue;
      const field = entry.loc[entry.loc.length - 1];
      if (field === "name" && (entry.type === "string_too_short" || entry.type === "missing")) return t("errors:reasons.connectionNameEmpty");
      if (field === "name" && entry.type === "string_too_long") return t("errors:reasons.connectionNameLength");
      if ((field === "target_name" || field === "new_name") && (entry.type === "string_too_short" || entry.type === "missing")) return t("errors:reasons.nameEmpty");
      if (field === "client_secret") return t("errors:reasons.clientSecret");
    }
  }
  return error.code && translatedCodes.includes(error.code)
    ? t(`errors:codes.${error.code}`) : t(error.operation === "write" ? "errors:codes.APPLICATION_ERROR" : "errors:readUnavailable");
}

export function translateMessage(message: NotificationMessage, t: TFunction): string {
  if (typeof message === "string") return message;
  if (message instanceof Error) return errorMessage(message, t);
  return t(message.key, { ...message.values, ...(message.error && { message: errorMessage(message.error, t) }) });
}
