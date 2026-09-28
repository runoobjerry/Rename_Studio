import { alpha, createTheme } from "@mui/material/styles";
import type { PaletteMode } from "@mui/material";

const accent = "#00ff9d";

export function createAppTheme(mode: PaletteMode) {
  const dark = mode === "dark";
  const textPrimary = dark ? "#f1f7f4" : "#14231d";
  const textSecondary = dark ? "#a5b8b0" : "#586a62";
  const textDisabled = dark ? "#70837a" : "#87958f";
  const accentText = dark ? "#35f2a3" : "#007a4b";
  const success = dark ? "#45e6a4" : "#007a4b";
  const warning = dark ? "#ffc56d" : "#925700";
  const error = dark ? "#ff9189" : "#b42318";
  const info = dark ? "#72d8cc" : "#146c64";

  return createTheme({
    palette: {
      mode,
      primary: {
        main: accent,
        light: dark ? "#72ffc4" : "#5dffc0",
        dark: accentText,
        contrastText: "#04130d",
      },
      success: {
        main: success,
        contrastText: dark ? "#04130d" : "#ffffff",
      },
      warning: {
        main: warning,
        contrastText: dark ? "#261500" : "#ffffff",
      },
      error: {
        main: error,
        contrastText: "#ffffff",
      },
      info: {
        main: info,
        contrastText: dark ? "#04130d" : "#ffffff",
      },
      background: {
        default: dark ? "#08110e" : "#f4f7f6",
        paper: dark ? "#101a16" : "#ffffff",
      },
      text: {
        primary: textPrimary,
        secondary: textSecondary,
        disabled: textDisabled,
      },
      action: {
        active: textSecondary,
        disabled: textDisabled,
        disabledBackground: dark ? "rgba(112,131,122,0.14)" : "rgba(135,149,143,0.12)",
        selected: alpha(accent, dark ? 0.14 : 0.12),
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
        styleOverrides: {
          root: {
            borderRadius: 10,
            "&.MuiButton-text.MuiButton-colorPrimary, &.MuiButton-outlined.MuiButton-colorPrimary": {
              color: accentText,
            },
            "&.MuiButton-outlined.MuiButton-colorPrimary": {
              borderColor: alpha(accentText, 0.42),
            },
            "&.MuiButton-contained.MuiButton-colorPrimary": {
              color: "#04130d",
              backgroundColor: accent,
            },
          },
        },
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
      MuiFormLabel: {
        styleOverrides: {
          root: { color: textSecondary },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          root: { color: textPrimary },
          input: {
            "&::placeholder": {
              color: textDisabled,
              opacity: 1,
            },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            color: textSecondary,
            "&.Mui-selected": { color: textPrimary },
          },
        },
      },
      MuiListItemIcon: {
        styleOverrides: {
          root: { color: "inherit" },
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
            "--accent-text": accentText,
            "--on-accent": "#04130d",
            "--app-background": dark ? "#08110e" : "#f4f7f6",
            "--app-surface": dark ? "#101a16" : "#ffffff",
            "--app-surface-muted": dark ? "#14221c" : "#f6f9f7",
            "--app-border": dark ? "rgba(255,255,255,0.09)" : "rgba(20,35,29,0.10)",
            "--app-text": textPrimary,
            "--app-text-muted": textSecondary,
            "--app-text-disabled": textDisabled,
            "--app-success": success,
            "--app-success-soft": alpha(success, dark ? 0.14 : 0.10),
            "--app-warning": warning,
            "--app-warning-soft": alpha(warning, dark ? 0.14 : 0.10),
            "--app-danger": error,
            "--app-danger-soft": alpha(error, dark ? 0.14 : 0.09),
            "--app-info": info,
            "--app-info-soft": alpha(info, dark ? 0.14 : 0.09),
            "--on-danger": "#ffffff",
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
