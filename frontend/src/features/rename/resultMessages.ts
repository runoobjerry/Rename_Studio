import type { TFunction } from "i18next";
import { errorMessage } from "../../i18n/messages";
import type { ExecuteItem } from "../../types";

// 适配当前 API 的执行消息，集中处理展示，不改变执行结果或错误码。
export function isRenameNotAttempted(item: ExecuteItem): boolean {
  return item.error === "Rename was not attempted" || item.error === "Rename was not attempted after an unknown write outcome";
}

export function executionItemMessage(item: ExecuteItem, t: TFunction): string {
  if (isRenameNotAttempted(item)) {
    return t(item.error === "Rename was not attempted after an unknown write outcome"
      ? "files:preview.notAttempted" : "files:preview.notAttemptedOther");
  }
  if (item.error?.includes("; rollback failed:") || item.error?.includes("; rollback skipped because")) {
    return t("files:preview.restoreFailed");
  }
  if (item.current_file && item.actual_name === item.original_name) return t("files:preview.restored");
  return item.error === null ? t("files:preview.failed") : errorMessage({ code: item.error_code, message: item.error }, t);
}
