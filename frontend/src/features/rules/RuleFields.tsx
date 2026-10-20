import { useTranslation } from "react-i18next";
import { useState } from "react";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import RemoveRoundedIcon from "@mui/icons-material/RemoveRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";

import type { RuleSpec } from "../../types";

const ruleFieldsSx = {
  "& .MuiInputBase-root": { height: 38, fontSize: 13 },
} as const;

interface RuleFieldsProps {
  rule: RuleSpec;
  onChange: (values: Record<string, unknown>) => void;
}

function valueAsString(rule: RuleSpec, key: string, fallback: string): string {
  return String(rule.config[key] ?? fallback);
}

interface NumberStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function NumberStepper({ label, value, min, max, onChange }: NumberStepperProps) {
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
    // 输入中允许清空或暂时越界；规则配置始终只接收范围内的整数。
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
          color: "text.secondary",
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
          bgcolor: "transparent",
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
        aria-label={t("rules:fields.decrease", { label })}
      >
        <RemoveRoundedIcon fontSize="small" />
      </IconButton>
      <input
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
        aria-label={t("rules:fields.increase", { label })}
      >
        <AddRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

function PaddingFields({ rule, onChange }: RuleFieldsProps) {
  const { t } = useTranslation();
  const mode = valueAsString(rule, "mode", "number");

  return (
    <Box className="rule-fields" sx={ruleFieldsSx}>
      <label>
        {t("rules:fields.paddingMode")}
        <TextField
          select
          fullWidth
          size="small"
          value={mode}
          onChange={(event) => onChange({ mode: event.target.value })}
          slotProps={{ select: { inputProps: { "aria-label": t("rules:fields.paddingMode") } } }}
        >
          <MenuItem value="number">{t("rules:fields.numberPadding")}</MenuItem>
          <MenuItem value="text">{t("rules:fields.textPadding")}</MenuItem>
        </TextField>
      </label>
      <label>
        {t("rules:fields.length")}
        <NumberStepper
          label={t("rules:fields.length")}
          min={1}
          max={255}
          value={Number(rule.config.length ?? 3)}
          onChange={(value) => onChange({ length: value })}
        />
      </label>
      {mode === "text" && (
        <>
          <label>
            {t("rules:fields.fillCharacter")}
            <TextField
              fullWidth
              hiddenLabel
              size="small"
              value={valueAsString(rule, "fill_character", "_")}
              onChange={(event) => onChange({ fill_character: event.target.value })}
              slotProps={{ htmlInput: { maxLength: 1, "aria-label": t("rules:fields.fillCharacter") } }}
            />
          </label>
          <label>
            {t("rules:fields.side")}
            <TextField
              select
              fullWidth
              size="small"
              value={valueAsString(rule, "side", "left")}
              onChange={(event) => onChange({ side: event.target.value })}
              slotProps={{ select: { inputProps: { "aria-label": t("rules:fields.side") } } }}
            >
              <MenuItem value="left">{t("rules:fields.left")}</MenuItem>
              <MenuItem value="right">{t("rules:fields.right")}</MenuItem>
            </TextField>
          </label>
        </>
      )}
    </Box>
  );
}

function TextOperationFields({ rule, onChange }: RuleFieldsProps) {
  const { t } = useTranslation();
  const isReplace = rule.type === "replace";

  return (
    <>
      <Box className="rule-fields" sx={ruleFieldsSx}>
        <label>
          {isReplace ? t("rules:fields.search") : t("rules:fields.removeText")}
          <TextField
            fullWidth
            hiddenLabel
            size="small"
            value={valueAsString(rule, "search", "")}
            onChange={(event) => onChange({ search: event.target.value })}
            slotProps={{
              htmlInput: { "aria-label": isReplace ? t("rules:fields.search") : t("rules:fields.removeText") },
            }}
          />
        </label>
        {isReplace && (
          <label>
            {t("rules:fields.replacement")}
            <TextField
              fullWidth
              hiddenLabel
              size="small"
              value={valueAsString(rule, "replacement", "")}
              onChange={(event) => onChange({ replacement: event.target.value })}
              slotProps={{ htmlInput: { "aria-label": t("rules:fields.replacement") } }}
            />
          </label>
        )}
        <label>
          {t("rules:fields.occurrence")}
          <TextField
            select
            fullWidth
            size="small"
            value={valueAsString(rule, "occurrence", "all")}
            onChange={(event) => onChange({ occurrence: event.target.value })}
            slotProps={{ select: { inputProps: { "aria-label": t("rules:fields.occurrence") } } }}
          >
            <MenuItem value="all">{t("rules:fields.all")}</MenuItem>
            <MenuItem value="first">{t("rules:fields.first")}</MenuItem>
            <MenuItem value="last">{t("rules:fields.last")}</MenuItem>
          </TextField>
        </label>
      </Box>
      <div className="rule-options">
        <label className="option-toggle">
          <Checkbox
            size="small"
            checked={Boolean(rule.config.case_sensitive ?? true)}
            onChange={(event) => onChange({ case_sensitive: event.target.checked })}
            slotProps={{ input: { "aria-label": t("rules:fields.caseSensitive") } }}
          />
          {t("rules:fields.caseSensitive")}
        </label>
        <label className="option-toggle">
          <Checkbox
            size="small"
            checked={Boolean(rule.config.whole_word ?? false)}
            onChange={(event) => onChange({ whole_word: event.target.checked })}
            slotProps={{ input: { "aria-label": t("rules:fields.wholeWord") } }}
          />
          {t("rules:fields.wholeWord")}
        </label>
        <label className="option-toggle">
          <Checkbox
            size="small"
            checked={Boolean(rule.config.ignore_extension ?? true)}
            onChange={(event) => onChange({ ignore_extension: event.target.checked })}
            slotProps={{ input: { "aria-label": t("rules:fields.ignoreExtension") } }}
          />
          {t("rules:fields.ignoreExtension")}
        </label>
      </div>
    </>
  );
}

function InsertFields({ rule, onChange }: RuleFieldsProps) {
  const { t } = useTranslation();
  const position = valueAsString(rule, "position", "prefix");
  const usesIndex = position === "index";
  const usesAnchor = position === "before_text" || position === "after_text";

  return (
    <>
      <Box className="rule-fields" sx={ruleFieldsSx}>
        <label>
          {t("rules:fields.insertText")}
          <TextField
            fullWidth
            hiddenLabel
            size="small"
            value={valueAsString(rule, "text", "")}
            onChange={(event) => onChange({ text: event.target.value })}
            slotProps={{ htmlInput: { "aria-label": t("rules:fields.insertText") } }}
          />
        </label>
        <label>
          {t("rules:fields.position")}
          <TextField
            select
            fullWidth
            size="small"
            value={position}
            onChange={(event) => onChange({ position: event.target.value })}
            slotProps={{ select: { inputProps: { "aria-label": t("rules:fields.position") } } }}
          >
            <MenuItem value="prefix">{t("rules:fields.prefix")}</MenuItem>
            <MenuItem value="suffix">{t("rules:fields.suffix")}</MenuItem>
            <MenuItem value="index">{t("rules:fields.indexPosition")}</MenuItem>
            <MenuItem value="before_text">{t("rules:fields.beforeText")}</MenuItem>
            <MenuItem value="after_text">{t("rules:fields.afterText")}</MenuItem>
          </TextField>
        </label>
        {usesIndex && (
          <label>
            {t("rules:fields.index")}
            <NumberStepper
              label={t("rules:fields.index")}
              min={1}
              max={255}
              value={Number(rule.config.index ?? 1)}
              onChange={(value) => onChange({ index: value })}
            />
          </label>
        )}
        {usesAnchor && (
          <label>
            {t("rules:fields.anchor")}
            <TextField
              fullWidth
              hiddenLabel
              size="small"
              value={valueAsString(rule, "anchor", "")}
              onChange={(event) => onChange({ anchor: event.target.value })}
              slotProps={{ htmlInput: { "aria-label": t("rules:fields.anchor") } }}
            />
          </label>
        )}
      </Box>
      {usesIndex && (
        <div className="rule-options">
          <label className="option-toggle">
            <Checkbox
              size="small"
              checked={Boolean(rule.config.from_right ?? false)}
              onChange={(event) => onChange({ from_right: event.target.checked })}
              slotProps={{ input: { "aria-label": t("rules:fields.fromRight") } }}
            />
            {t("rules:fields.fromRight")}
          </label>
        </div>
      )}
    </>
  );
}

export function RuleFields(props: RuleFieldsProps) {
  const { t } = useTranslation();
  if (props.rule.type === "padding") return <PaddingFields {...props} />;
  if (props.rule.type === "replace" || props.rule.type === "remove") {
    return <TextOperationFields {...props} />;
  }
  if (props.rule.type === "insert") return <InsertFields {...props} />;
  return <Alert severity="error">{t("rules:unsupported", { type: props.rule.type })}</Alert>;
}
