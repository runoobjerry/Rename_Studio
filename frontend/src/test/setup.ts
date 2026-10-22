import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";
import { i18n, loadLanguageResources } from "../i18n";

// jsdom 不提供 Canvas 文本测量；测试只验证虚拟窗口和选择语义，不验证真实字体宽度。
beforeEach(async () => {
  await loadLanguageResources("zh-CN");
  await i18n.changeLanguage("zh-CN");
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
  vi.spyOn(navigator, "language", "get").mockReturnValue("zh-CN");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as CanvasRenderingContext2D);
});
