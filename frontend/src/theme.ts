import { alpha, createTheme } from "@mui/material/styles";
import type { PaletteMode } from "@mui/material";

const accent = "#00ff9d";

export function createAppTheme(mode: PaletteMode) {
  const dark = mode === "dark";

  return createTheme({
    palette: {
      mode,
      primary: {
        main: accent,
        contrastText: "#04130d",
      },
      background: {
        default: dark ? "#08110e" : "#f4f7f6",
        paper: dark ? "#101a16" : "#ffffff",
      },
      text: {
        primary: dark ? "#f1f7f4" : "#14231d",
        secondary: dark ? "#9aada5" : "#60716a",
      },
      divider: dark ? "rgba(255,255,255,0.09)" : "rgba(20,35,29,0.10)",
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h4: { fontWeight: 760, letterSpacing: "-0.035em" },
      h6: { fontWeight: 720, letterSpacing: "-0.015em" },
      button: { fontWeight: 700, textTransform: "none" },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 10 } },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            borderColor: dark ? "rgba(255,255,255,0.09)" : "rgba(20,35,29,0.10)",
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 700 },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            marginTop: 4,
            border: `1px solid ${dark ? "rgba(255,255,255,0.09)" : "rgba(20,35,29,0.10)"}`,
            backgroundImage: "none",
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            minHeight: 34,
            margin: "2px 6px",
            borderRadius: 8,
            fontSize: 13,
          },
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          ":root": {
            "--accent": accent,
            "--accent-soft": alpha(accent, dark ? 0.14 : 0.12),
            "--app-surface": dark ? "#101a16" : "#ffffff",
            "--app-surface-muted": dark ? "#14221c" : "#f6f9f7",
            "--app-border": dark ? "rgba(255,255,255,0.09)" : "rgba(20,35,29,0.10)",
            "--app-text": dark ? "#f1f7f4" : "#14231d",
            "--app-text-muted": dark ? "#9aada5" : "#60716a",
            "--app-danger": dark ? "#ff9d96" : "#a83f38",
            "--app-danger-soft": dark ? "rgba(255,100,90,0.13)" : "#fff0ee",
            "--app-scrollbar-thumb": dark ? "#3b4f46" : "#c4d0ca",
            "--app-scrollbar-thumb-hover": dark ? "#526b60" : "#98aaa1",
          },
          body: { minWidth: 320 },
          "button, input, select": { font: "inherit" },
        },
      },
    },
  });
}
