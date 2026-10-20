import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { i18n } from "./index";
import { errorMessage, translateMessage } from "./messages";

describe("translated diagnostics", () => {
  it("uses a stable code and keeps the original diagnostic fields", () => {
    const error = new ApiError(401, "Expired grant", "AUTHENTICATION_ERROR", { request_id: "request-1" });
    expect(errorMessage(error, i18n.getFixedT("zh-CN"))).toBe("账号授权失效，请重新登录。Expired grant");
    expect(errorMessage(error, i18n.getFixedT("en-US"))).toBe("Account authorization is invalid. Sign in again. Expired grant");
    expect(error.code).toBe("AUTHENTICATION_ERROR");
    expect(error.message).toBe("Expired grant");
    expect(error.details).toEqual({ request_id: "request-1" });
  });

  it("does not infer a category from an unknown code or message", () => {
    const message = "Authentication failed; preview expired";
    for (const error of [new Error(message), new ApiError(502, message, "FUTURE_PROVIDER_ERROR")]) {
      expect(errorMessage(error, i18n.getFixedT("zh-CN"))).toBe(message);
      expect(errorMessage(error, i18n.getFixedT("en-US"))).toBe(message);
    }
  });

  it("translates an error inside a notification when it is displayed", () => {
    const message = { key: "files:notifications.previewFailed", error: new ApiError(429, "Retry later", "RATE_LIMIT_ERROR") };
    expect(translateMessage(message, i18n.getFixedT("zh-CN"))).toBe("预览失败：请求过于频繁，请稍后重试。Retry later");
    expect(translateMessage(message, i18n.getFixedT("en-US"))).toBe("Preview failed: Too many requests. Try again later. Retry later");
  });
});
