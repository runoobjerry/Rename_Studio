import type { TFunction } from "i18next";
import { errorMessage } from "../../i18n/messages";
import type { ExecuteItem, RenameItemOutcome } from "../../types";

// 兼容现有三值 status；结果语义由稳定字段决定，元数据完整性由工作流单独处理。
export function renameItemOutcome(item: Pick<ExecuteItem, "status" | "error_code" | "details">): RenameItemOutcome {
  if (item.status !== "failed") return item.status;
  if (item.error_code === "RENAME_OUTCOME_UNKNOWN") return "unknown";
  if (item.details?.reason === "RENAME_NOT_ATTEMPTED") return "not_attempted";
  return "failed";
}

export function isRenameNotAttempted(item: ExecuteItem): boolean {
  return renameItemOutcome(item) === "not_attempted";
}

export function executionItemMessage(item: ExecuteItem, t: TFunction): string {
  if (isRenameNotAttempted(item)) {
    return t(item.details?.stop_reason === "RENAME_OUTCOME_UNKNOWN"
      ? "files:preview.notAttempted" : "files:preview.notAttemptedOther");
  }
  return item.error === null ? t("files:preview.failed")
    : errorMessage({ code: item.error_code, message: item.error, details: item.details ?? undefined }, t);
}
