import { useId, useLayoutEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Drawer from "@mui/material/Drawer";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";

import rightPanelIcon from "../../assets/icon/right_panel.svg";
import type { RuleSpec } from "../../types";

const positions = [
  ["prefix", "rules:userInput.prefix"],
  ["suffix", "rules:userInput.suffix"],
  ["replace", "rules:userInput.replace"],
] as const;

const nativeTextareaSx = (theme: Theme) => ({
  colorScheme: theme.palette.mode,
  "& textarea": { whiteSpace: "pre", overflowWrap: "normal" },
  "& textarea:not([aria-hidden])": {
    // MUI autosizing can hide horizontal overflow when the text fits vertically.
    overflow: "auto !important",
    scrollbarColor: "var(--app-scrollbar-thumb) transparent",
    scrollbarWidth: "thin",
  },
} as const);

const compactInputSx = {
  "& .MuiInputBase-root": { fontSize: "13px" },
  "& textarea:placeholder-shown": { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
} as const;

interface UserInputFieldsProps {
  rule: RuleSpec;
  onChange: (values: Record<string, unknown>) => void;
  editorPanelRef: RefObject<HTMLElement>;
}

export function UserInputFields({ rule, onChange, editorPanelRef }: UserInputFieldsProps) {
  const { t } = useTranslation();
  const drawerTitleId = useId();
  const inputId = useId();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelLeft, setPanelLeft] = useState(0);
  const text = String(rule.config.text ?? "");
  const inputLabel = t("rules:userInput.text");
  const expandLabel = t("rules:userInput.expand");

  useLayoutEffect(() => {
    if (!drawerOpen) return;
    const panel = editorPanelRef.current!;
    const update = () => setPanelLeft(Math.max(0, panel.getBoundingClientRect().left));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [drawerOpen, editorPanelRef]);

  return (
    <>
      <Box className="rule-fields" sx={{ gridTemplateColumns: "minmax(0, 1fr)", gap: "6px" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0.5 }}>
          <label htmlFor={inputId}>{inputLabel}</label>
          <Tooltip title={expandLabel}>
            <IconButton
              size="small"
              disableRipple
              aria-label={expandLabel}
              aria-haspopup="dialog"
              onClick={() => setDrawerOpen(true)}
              sx={{
                p: 0,
                "&:hover": { color: "primary.main", bgcolor: "transparent" },
                "&:active": { bgcolor: "transparent" },
                "&.Mui-focusVisible": { outline: "2px solid currentColor", outlineOffset: "2px" },
              }}
            >
              <Box component="span" aria-hidden="true" sx={{
                width: 20,
                height: 20,
                bgcolor: "currentColor",
                mask: `url("${rightPanelIcon}") center / contain no-repeat`,
                WebkitMask: `url("${rightPanelIcon}") center / contain no-repeat`,
              }} />
            </IconButton>
          </Tooltip>
        </Box>
        <TextField
          id={inputId}
          fullWidth
          multiline
          hiddenLabel
          size="small"
          minRows={3}
          maxRows={10}
          placeholder={t("rules:userInput.hint")}
          value={text}
          onChange={(event) => onChange({ text: event.target.value })}
          slotProps={{ htmlInput: { wrap: "off" } }}
          sx={[nativeTextareaSx, compactInputSx]}
        />
      </Box>

      <RadioGroup
        row
        aria-label={t("rules:userInput.position")}
        value={String(rule.config.position ?? "replace")}
        onChange={(_, position) => onChange({ position })}
        sx={{ columnGap: 1, mt: 1 }}
      >
        {positions.map(([position, label]) => (
          <FormControlLabel
            key={position}
            value={position}
            label={t(label)}
            control={<Radio size="small" />}
            slotProps={{ typography: { sx: { fontSize: "13px" } } }}
            sx={{ m: 0 }}
          />
        ))}
      </RadioGroup>
      <Box className="rule-options" sx={{ mt: 0 }}>
        <label className="option-toggle">
          <Checkbox
            size="small"
            checked={Boolean(rule.config.ignore_extension ?? true)}
            onChange={(event) => onChange({ ignore_extension: event.target.checked })}
          />
          {t("rules:fields.ignoreExtension")}
        </label>
      </Box>

      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        slotProps={{
          paper: { "aria-labelledby": drawerTitleId, sx: { left: `${panelLeft}px`, p: 2, gap: 2 } },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography component="h2" variant="h6" id={drawerTitleId}>{t("rules:userInput.drawerTitle")}</Typography>
          <IconButton aria-label={t("common:close")} onClick={() => setDrawerOpen(false)}>
            <CloseRoundedIcon />
          </IconButton>
        </Box>
        <TextField
          fullWidth
          multiline
          autoFocus
          hiddenLabel
          value={text}
          onChange={(event) => onChange({ text: event.target.value })}
          slotProps={{ input: { inputComponent: "textarea" }, htmlInput: { "aria-label": inputLabel, wrap: "off" } }}
          sx={[
            nativeTextareaSx,
            {
              flex: 1,
              minHeight: 0,
              "& .MuiInputBase-root": { flex: 1, alignItems: "stretch", minHeight: 0 },
            },
          ]}
        />
      </Drawer>
    </>
  );
}
