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

const translatedValidationReasons = [
  "PREVIEW_DUPLICATE_FILE_IDS", "PREVIEW_ITEMS_NOT_IN_DIRECTORY",
];

export function errorMessage(error: { message: string; code?: string | null; details?: Record<string, unknown> }, t: TFunction = i18n.t): string {
  const reason = error.details?.reason;
  if (error.code === "VALIDATION_ERROR" && typeof reason === "string" && translatedValidationReasons.includes(reason)) {
    return t(`errors:validationReasons.${reason}`);
  }
  return error.code && translatedCodes.includes(error.code)
    ? t(`errors:codes.${error.code}`, { message: error.message }) : error.message;
}

export function translateMessage(message: NotificationMessage, t: TFunction): string {
  if (typeof message === "string") return message;
  if (message instanceof Error) return errorMessage(message, t);
  return t(message.key, { ...message.values, ...(message.error && { message: errorMessage(message.error, t) }) });
}
