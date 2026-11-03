import type { TFunction } from "i18next";
import { errorMessage } from "../../i18n/messages";
import type { ExecuteItem } from "../../types";

export function executionItemMessage(item: ExecuteItem, t: TFunction): string {
  if (item.status === "unknown") return t("files:preview.unknown");
  if (item.status === "not_attempted") {
    return t(item.details?.stop_reason === "RENAME_OUTCOME_UNKNOWN"
      ? "files:preview.notAttempted" : "files:preview.notAttemptedOther");
  }
  return !item.error_code && item.error === null ? t("files:preview.failed")
    : errorMessage({ code: item.error_code, message: item.error ?? "", details: item.details ?? undefined, operation: "write" }, t);
}
