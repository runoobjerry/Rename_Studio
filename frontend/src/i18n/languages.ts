import type { Resource } from "i18next";

export interface LanguageMeta {
  code: string;
  name: string;
}

export const fallbackLanguage = "en-US";
export const namespaces = ["common", "settings", "files", "rules", "providers", "errors"] as const;

const metadata = import.meta.glob<LanguageMeta>("../locales/*/meta.json", { eager: true, import: "default" });
export const languages = Object.values(metadata);
const dictionaries = import.meta.glob<Record<string, unknown>>("../locales/*/*.json", { eager: true, import: "default" });
export const resources: Resource = {};
for (const [path, dictionary] of Object.entries(dictionaries)) {
  const [, code, filename] = path.match(/\/locales\/([^/]+)\/([^/]+)\.json$/)!;
  if (filename !== "meta") (resources[code] ??= {})[filename] = dictionary;
}

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
