import { createCatalog, type LanguageMeta } from "./catalog";

export const fallbackLanguage = "en-US";
export const namespaces = ["common", "settings", "files", "rules", "providers", "errors"] as const;

const metadata = import.meta.glob<LanguageMeta>("../locales/*/meta.json", { eager: true, import: "default" });
const dictionaries = import.meta.glob<Record<string, unknown>>(
  ["../locales/*/*.json", "!../locales/*/meta.json", "!../locales/en-US/*.json"], { import: "default" },
);
export const { languages, loadLanguage } = createCatalog(metadata, dictionaries);

export function browserLanguages(): readonly string[] {
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export function resolveLanguage(
  preference: string,
  candidates: readonly string[] = browserLanguages(),
  supported: readonly string[] = languages.map(({ code }) => code),
): string {
  const exact = (code: string) => supported.find((entry) => entry.toLowerCase() === code.toLowerCase());
  // An unsupported saved choice is retained; only auto uses browser aliases.
  if (preference !== "auto") return exact(preference) ?? fallbackLanguage;
  for (const candidate of candidates) {
    const match = exact(candidate);
    if (match) return match;
    const code = candidate.toLowerCase();
    const equivalent = code === "en" || code.startsWith("en-") ? "en-US"
      : /^zh(?:-hans(?:-(?:cn|sg))?|-(?:cn|sg))?$/.test(code) ? "zh-CN" : null;
    const alias = equivalent ? exact(equivalent) : undefined;
    if (alias) return alias;
  }
  return fallbackLanguage;
}
