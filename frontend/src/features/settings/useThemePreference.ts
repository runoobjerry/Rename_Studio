import { useRef, useState } from "react";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { PaletteMode } from "@mui/material";
import { useAppSettings } from "./useAppSettings";
import type { ThemePreference } from "../../types";

export type { ThemePreference } from "../../types";

export function useThemePreference() {
  const settings = useAppSettings();
  const [draft, setDraft] = useState<ThemePreference | null>(null);
  const editId = useRef(0);
  const preference = draft ?? settings.data?.preferences.theme ?? "system";
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const mode: PaletteMode = preference === "system" ? systemDark ? "dark" : "light" : preference;

  const setPreference = async (next: ThemePreference): Promise<void> => {
    const id = ++editId.current;
    setDraft(next);
    try {
      await settings.save({ theme: next });
    } finally {
      if (editId.current === id) setDraft(null);
    }
  };

  return { preference, setPreference, mode, settingsError: settings.error, hasSettings: settings.data !== undefined };
}
