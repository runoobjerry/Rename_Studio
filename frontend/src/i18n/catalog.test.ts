import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import { createCatalog, type LanguageMeta } from "./catalog";
import { namespaces, resolveLanguage } from "./languages";
import { i18n } from "./index";

const metadata = import.meta.glob<LanguageMeta>("./__fixtures__/locales/*/meta.json", { eager: true, import: "default" });
const dictionaries = import.meta.glob<Record<string, unknown>>(
  ["./__fixtures__/locales/*/*.json", "!./__fixtures__/locales/*/meta.json"], { import: "default" },
);

describe("language directory discovery", () => {
  it("discovers a new directory via Vite and uses English for its untranslated namespaces", async () => {
    const catalog = createCatalog(metadata, dictionaries);
    expect(catalog.languages).toEqual([{ code: "fr-FR", name: "Français" }]);
    const supported = ["en-US", ...catalog.languages.map(({ code }) => code)];
    const locale = resolveLanguage("auto", ["fr-FR", "en-US"], supported);
    const instance = createInstance();
    await instance.init({ resources: { "en-US": i18n.getDataByLanguage("en-US")!, [locale]: await catalog.loadLanguage(locale) },
      supportedLngs: supported, lng: locale, fallbackLng: "en-US", load: "currentOnly",
      ns: [...namespaces], defaultNS: "common", initAsync: false });
    expect(locale).toBe("fr-FR");
    expect(instance.t("cancel")).toBe("Annuler");
    expect(instance.t("settings:title")).toBe("Settings");
    expect(instance.t("rules:types.padding.name")).toBe("Padding");
    expect(instance.t("providers:local.fields.root_path.label")).toBe("Local root directory");
  });
});
