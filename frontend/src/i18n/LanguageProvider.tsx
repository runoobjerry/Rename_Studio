import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Skeleton } from "@mui/material";
import { I18nextProvider } from "react-i18next";
import { useAppSettings } from "../features/settings/useAppSettings";
import { i18n, isLanguageLoaded, loadLanguageResources } from "./index";
import { fallbackLanguage, resolveLanguage } from "./languages";

interface LanguageContextValue {
  preference: string;
  locale: string;
  failedLanguage: string | null;
  setPreference: (next: string) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const settings = useAppSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const editId = useRef(0);
  const preference = draft ?? settings.data?.preferences.language ?? "auto";
  const [environment, setEnvironment] = useState(0);
  const requestedLocale = resolveLanguage(preference);
  const [locale, setLocale] = useState(fallbackLanguage);
  const [failedLanguage, setFailedLanguage] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (preference !== "auto") return;
    const changed = () => setEnvironment((current) => current + 1);
    window.addEventListener("languagechange", changed);
    return () => window.removeEventListener("languagechange", changed);
  }, [preference]);

  useLayoutEffect(() => {
    if (settings.isPending) return;
    let active = true;
    setFailedLanguage(null);
    const apply = () => {
      if (!active) return;
      void i18n.changeLanguage(requestedLocale);
      document.documentElement.lang = requestedLocale;
      setLocale(requestedLocale);
      setStarted(true);
    };
    if (isLanguageLoaded(requestedLocale)) apply();
    else void loadLanguageResources(requestedLocale).then(apply, () => {
      if (!active) return;
      // Initial failure shows English; later failures retain the current UI and task.
      setFailedLanguage(requestedLocale);
      setStarted(true);
    });
    return () => { active = false; };
  }, [settings.isPending, requestedLocale, environment]);

  const setPreference = async (next: string) => {
    const id = ++editId.current;
    setDraft(next);
    try {
      await settings.save({ language: next });
    } finally {
      if (editId.current === id) setDraft(null);
    }
  };

  return (
    <I18nextProvider i18n={i18n}>
      <LanguageContext.Provider value={{ preference, locale, failedLanguage, setPreference }}>
        {started ? children : <Skeleton variant="rounded" height={180} sx={{ m: 3 }} aria-busy="true" />}
      </LanguageContext.Provider>
    </I18nextProvider>
  );
}

export function useLanguagePreference() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguagePreference requires LanguageProvider");
  return context;
}
