import type { ResourceLanguage } from "i18next";

export interface LanguageMeta {
  code: string;
  name: string;
}

// Vite supplies the file maps; adding a language never requires a code registration.
export function createCatalog(metadata: Record<string, LanguageMeta>, dictionaries: Record<string, () => Promise<Record<string, unknown>>>) {
  const modules: Record<string, Record<string, () => Promise<Record<string, unknown>>>> = {};
  const loading = new Map<string, Promise<ResourceLanguage>>();
  for (const [path, load] of Object.entries(dictionaries)) {
    const [, code, filename] = path.match(/\/locales\/([^/]+)\/([^/]+)\.json$/)!;
    (modules[code] ??= {})[filename] = load;
  }
  function loadLanguage(code: string): Promise<ResourceLanguage> {
    let pending = loading.get(code);
    if (!pending) {
      pending = Promise.all(Object.entries(modules[code]).map(async ([namespace, load]) =>
        [namespace, await load()] as const)).then((entries) => Object.fromEntries(entries));
      loading.set(code, pending);
      // Keep completed bundles; failed downloads must not permanently poison the cache.
      void pending.catch(() => loading.delete(code));
    }
    return pending;
  }
  return { languages: Object.values(metadata), loadLanguage };
}
