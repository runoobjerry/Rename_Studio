import type { ReactNode } from "react";
import { Box, ButtonGroup } from "@mui/material";

const panelBackground = "var(--app-surface)";
const panelBorder = "var(--app-border)";

export function PanelSummary({ children }: { children: ReactNode }) {
  return (
    <Box className="panel-summary" component="span"
      sx={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
        minWidth: 0, minHeight: 30, px: "10px", py: "4px",
        backgroundColor: panelBackground, border: 1, borderColor: panelBorder, borderRadius: 1, color: "text.secondary",
        fontSize: 12, fontWeight: "fontWeightRegular", lineHeight: 1.5,
        textAlign: "left",
      }}>
      {children}
    </Box>
  );
}

export function PanelActionGroup({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <ButtonGroup aria-labelledby={labelledBy} variant="outlined" color="inherit" size="small"
      sx={{
        flexShrink: 0, marginInlineStart: "auto", color: "text.secondary",
        backgroundColor: panelBackground,
        "& > span": { display: "flex" },
        "& .MuiButtonGroup-grouped": {
          minWidth: 36, height: 30, px: "6px", borderColor: panelBorder,
          "&.Mui-disabled": { borderColor: panelBorder },
          "@media (hover: hover)": {
            "&:not(.Mui-disabled):hover": { borderColor: "primary.main", position: "relative", zIndex: 1 },
          },
        },
        "& .MuiSvgIcon-root": { fontSize: 20 },
      }}>
      {children}
    </ButtonGroup>
  );
}
