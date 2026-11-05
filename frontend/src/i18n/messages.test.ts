import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { i18n } from "./index";
import { errorMessage, translateMessage } from "./messages";

describe("translated diagnostics", () => {
  it("uses an application reason for a changed source without interpreting provider diagnostics", () => {
    const t = i18n.getFixedT("zh-CN");
    expect(errorMessage({ code: "RENAME_CONFLICT", message: "Precondition failed",
      details: { reason: "SOURCE_CHANGED" } }, t)).toBe("文件状态已变化，请刷新目录后重试。");
    expect(errorMessage({ code: "RENAME_CONFLICT", message: "Precondition failed",
      details: { graph_status: 412 } }, t)).toBe("此目录中已存在同名项目，请修改新名称后重试。");
  });

  it("uses a stable code and keeps the original diagnostic fields", () => {
    const error = new ApiError(401, "Expired grant", "AUTHENTICATION_ERROR", {
      request_id: "request-1", reason: "AUTHORIZATION_EXPIRED", params: {},
    });
    expect(errorMessage(error, i18n.getFixedT("zh-CN"))).toBe("账号授权失效，请前往设置重新授权。");
    expect(errorMessage(error, i18n.getFixedT("en-US"))).toBe("Account authorization has expired. Go to Settings and authorize the account again.");
    expect(error.code).toBe("AUTHENTICATION_ERROR");
    expect(error.message).toBe("Expired grant");
    expect(error.details).toEqual({ request_id: "request-1", reason: "AUTHORIZATION_EXPIRED", params: {} });
  });

  it("does not infer a category from an unknown code or message", () => {
    const message = "Authentication failed; preview expired";
    for (const error of [new Error(message), new ApiError(502, message, "FUTURE_PROVIDER_ERROR")]) {
      expect(errorMessage(error, i18n.getFixedT("zh-CN"))).toBe("无法获取数据，请检查网络连接。");
      expect(errorMessage(error, i18n.getFixedT("en-US"))).toBe("Could not retrieve data. Check your network connection.");
    }
  });

  it("translates an error inside a notification when it is displayed", () => {
    const message = { key: "files:notifications.refreshFailed", error: new ApiError(429, "Retry later", "RATE_LIMIT_ERROR") };
    expect(translateMessage(message, i18n.getFixedT("zh-CN"))).toBe("刷新失败：请求过于频繁，请稍后重试。");
    expect(translateMessage(message, i18n.getFixedT("en-US"))).toBe("Refresh failed: Too many requests. Try again later.");
  });
});
