import { describe, expect, it, vi } from "vitest";
import { browserLanguages, languages, resolveLanguage } from "./languages";
import { i18n } from "./index";
import { formatDate } from "./format";

describe("language resolution", () => {
  it.each([
    [["fr-FR", "zh-CN", "en-US"], "zh-CN"],
    [["en-GB", "zh-CN"], "en-US"],
    [["zh-SG", "en-US"], "zh-CN"],
    [["zh-Hans", "en-US"], "zh-CN"],
    [["zh-Hans-CN", "en-US"], "zh-CN"],
    [["zh-Hans-SG", "en-US"], "zh-CN"],
    [["en-AU", "zh-CN"], "en-US"],
    [["zh", "en-US"], "zh-CN"],
    [["zh-TW", "zh-Hant", "zh-HK"], "en-US"],
    [["fr-FR"], "en-US"],
    [[], "en-US"],
  ])("resolves auto candidates %j to %s", (candidates, expected) => {
    expect(resolveLanguage("auto", candidates)).toBe(expected);
  });

  it("honors an explicit preference and falls back for an unavailable saved language", () => {
    expect(resolveLanguage("zh-CN", ["en-US"])).toBe("zh-CN");
    expect(resolveLanguage("fr-FR", ["zh-CN"])).toBe("en-US");
  });

  it("discovers metadata and lets a future exact match precede aliases", () => {
    expect(languages).toEqual(expect.arrayContaining([
      { code: "zh-CN", name: "简体中文" }, { code: "en-US", name: "English" },
    ]));
    expect(resolveLanguage("auto", ["zh-TW", "en-US"], ["zh-TW", "zh-CN", "en-US"])).toBe("zh-TW");
    expect(resolveLanguage("auto", ["fr-FR"], ["fr-FR", "en-US"])).toBe("fr-FR");
  });

  it("uses the single browser language only when the preference list is empty", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-GB");
    expect(browserLanguages()).toEqual(["en-GB"]);
    expect(resolveLanguage("auto")).toBe("en-US");
  });

  it("falls back to English resources and formats with the effective language", async () => {
    i18n.addResource("en-US", "common", "fallbackExample", "English fallback");
    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("fallbackExample")).toBe("English fallback");
    expect(i18n.languages).toEqual(["zh-CN", "en-US"]);
    await i18n.changeLanguage("en-US");
    const date = new Date("2026-10-20T00:00:00Z");
    expect(formatDate(date, { timeZone: "Asia/Shanghai" })).toBe(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai" }).format(date));
  });
});
