import { useState } from "react";
import { useTranslation } from "react-i18next";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import RemoveRoundedIcon from "@mui/icons-material/RemoveRounded";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";

interface NumberFieldProps {
  id?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

export function NumberField({ id, label, value, min, max, onChange }: NumberFieldProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<{ text: string; value: number } | null>(null);
  const text = draft?.value === value ? draft.text : String(value);
  const updateValue = (nextValue: number) => {
    const next = Math.min(max, Math.max(min, Math.trunc(nextValue)));
    setDraft(null);
    if (next !== value) onChange(next);
  };
  const commitInput = () => {
    const parsed = Number(text);
    // 输入中允许清空或暂时越界；调用方始终只接收范围内的整数。
    updateValue(text.trim() && Number.isFinite(parsed) ? parsed : value);
  };

  return (
    <Box
      role="group"
      aria-label={label}
      sx={{
        display: "grid",
        gridTemplateColumns: "36px minmax(0, 1fr) 36px",
        alignItems: "stretch",
        minHeight: 38,
        overflow: "hidden",
        border: 1,
        borderColor: "divider",
        borderRadius: "9px",
        bgcolor: "action.hover",
        "&:focus-within": {
          borderColor: "primary.main",
          boxShadow: (theme) => `0 0 0 3px ${theme.palette.action.selected}`,
        },
        "& .MuiIconButton-root": {
          borderRadius: 0,
          color: "text.primary",
        },
        "& .MuiIconButton-root:first-of-type": {
          borderRight: 1,
          borderColor: "divider",
        },
        "& .MuiIconButton-root:last-of-type": {
          borderLeft: 1,
          borderColor: "divider",
        },
        "& input": {
          width: "100%",
          minWidth: 0,
          px: 0.5,
          py: 0.75,
          border: 0,
          color: "text.primary",
          bgcolor: "var(--app-surface-muted)",
          font: "inherit",
          fontSize: 13,
          fontWeight: 700,
          textAlign: "center",
          outline: "none",
          appearance: "textfield",
        },
        "& input::-webkit-inner-spin-button, & input::-webkit-outer-spin-button": {
          m: 0,
          appearance: "none",
        },
      }}
    >
      <IconButton
        type="button"
        size="small"
        disabled={value <= min}
        onClick={() => updateValue(value - 1)}
        aria-label={t("common:numberField.decrease", { label })}
      >
        <RemoveRoundedIcon fontSize="small" />
      </IconButton>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={1}
        inputMode="numeric"
        value={text}
        onChange={(event) => {
          const nextText = event.target.value;
          const parsed = Number(nextText);
          const valid = nextText.trim() !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max;
          setDraft({ text: nextText, value: valid ? parsed : value });
          if (valid && parsed !== value) onChange(parsed);
        }}
        onBlur={commitInput}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        aria-label={label}
      />
      <IconButton
        type="button"
        size="small"
        disabled={value >= max}
        onClick={() => updateValue(value + 1)}
        aria-label={t("common:numberField.increase", { label })}
      >
        <AddRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
