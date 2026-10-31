import { ApiError } from "../../api/client";
import { errorMessage, type LocalizedMessage } from "../../i18n/messages";

export function settingsFailureMessage(error: Error, operation: "reset" | "language" | "theme"): LocalizedMessage {
  // 只有明确的请求拒绝才能说明操作未完成；丢失响应和服务端异常均需核对。
  const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500;
  if (!rejected) return { key: operation === "reset" ? "settings:resetOutcomeUnknown" : "settings:saveOutcomeUnknown" };
  return operation === "reset"
    ? { key: "settings:resetFailed", values: { reason: errorMessage(error) } }
    : { key: `settings:${operation}SaveFailed`, error };
}
