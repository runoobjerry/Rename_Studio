import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { fallbackLanguage, languages, loadLanguage, namespaces } from "./languages";

const fallbackDictionaries = import.meta.glob<Record<string, unknown>>(
  ["../locales/en-US/*.json", "!../locales/en-US/meta.json"], { eager: true, import: "default" },
);
const fallbackResources = Object.fromEntries(Object.entries(fallbackDictionaries).map(([path, dictionary]) =>
  [path.slice(path.lastIndexOf("/") + 1, -5), dictionary]));

export const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources: { [fallbackLanguage]: fallbackResources },
  lng: fallbackLanguage,
  fallbackLng: fallbackLanguage,
  supportedLngs: languages.map(({ code }) => code),
  load: "currentOnly",
  ns: [...namespaces],
  defaultNS: "common",
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export function isLanguageLoaded(code: string): boolean {
  return i18n.hasResourceBundle(code, namespaces[0]);
}

export async function loadLanguageResources(code: string): Promise<void> {
  if (isLanguageLoaded(code)) return;
  const bundle = await loadLanguage(code);
  // Register only after every namespace is ready, so the UI never sees a partial language.
  for (const [namespace, dictionary] of Object.entries(bundle)) i18n.addResourceBundle(code, namespace, dictionary);
}
