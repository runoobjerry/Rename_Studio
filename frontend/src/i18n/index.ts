import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { fallbackLanguage, languages, namespaces, resources } from "./languages";

export const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources,
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
