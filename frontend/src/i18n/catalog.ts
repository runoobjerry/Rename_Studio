import type { Resource } from "i18next";

export interface LanguageMeta {
  code: string;
  name: string;
}

// Vite supplies the file maps; adding a language never requires a code registration.
export function createCatalog(metadata: Record<string, LanguageMeta>, dictionaries: Record<string, Record<string, unknown>>) {
  const resources: Resource = {};
  for (const [path, dictionary] of Object.entries(dictionaries)) {
    const [, code, filename] = path.match(/\/locales\/([^/]+)\/([^/]+)\.json$/)!;
    if (filename !== "meta") (resources[code] ??= {})[filename] = dictionary;
  }
  return { languages: Object.values(metadata), resources };
}
