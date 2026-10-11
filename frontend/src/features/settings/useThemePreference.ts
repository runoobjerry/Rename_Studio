import { useEffect, useState } from "react";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { PaletteMode } from "@mui/material";

export type ThemePreference = PaletteMode | "system";

export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const saved = window.localStorage.getItem("renamer-color-mode");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const mode: PaletteMode = preference === "system" ? systemDark ? "dark" : "light" : preference;

  useEffect(() => {
    window.localStorage.setItem("renamer-color-mode", preference);
  }, [preference]);

  return { preference, setPreference, mode };
}
