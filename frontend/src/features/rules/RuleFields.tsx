import { useTranslation } from "react-i18next";
import { useId, type ComponentProps, type RefObject } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";

import { NumberField } from "../../components/NumberField";
import type { RuleSpec } from "../../types";
import { UserInputFields } from "./UserInputFields";

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

function PaddingFields({ rule, onChange }: RuleFieldsProps) {
  const { t } = useTranslation();
  const lengthId = useId();
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
      <Box sx={{ display: "grid", gap: "6px", minWidth: 0 }}>
        <label htmlFor={lengthId}>{t("rules:fields.length")}</label>
        <NumberField
          id={lengthId}
          label={t("rules:fields.length")}
          min={1}
          max={255}
          value={Number(rule.config.length ?? 3)}
          onChange={(value) => onChange({ length: value })}
        />
      </Box>
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
  const indexId = useId();
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
          <Box sx={{ display: "grid", gap: "6px", minWidth: 0 }}>
            <label htmlFor={indexId}>{t("rules:fields.index")}</label>
            <NumberField
              id={indexId}
              label={t("rules:fields.index")}
              min={1}
              max={255}
              value={Number(rule.config.index ?? 1)}
              onChange={(value) => onChange({ index: value })}
            />
          </Box>
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

const deleteBoundaries = [
  {
    modeKey: "from_mode",
    label: "rules:delete.from",
    numericMode: "position",
    numericLabel: "rules:fields.index",
    numberKey: "from_position",
    delimiterLabel: "rules:delete.fromDelimiter",
    delimiterKey: "from_delimiter",
    options: { position: "rules:fields.indexPosition", delimiter: "rules:delete.delimiter" },
  },
  {
    modeKey: "until_mode",
    label: "rules:delete.until",
    numericMode: "count",
    numericLabel: "rules:delete.count",
    numberKey: "until_count",
    delimiterLabel: "rules:delete.untilDelimiter",
    delimiterKey: "until_delimiter",
    options: { count: "rules:delete.count", delimiter: "rules:delete.delimiter", end: "rules:delete.end" },
  },
] as const;

function DeleteFields({ rule, onChange }: RuleFieldsProps) {
  const { t } = useTranslation();
  const deleteCurrentName = Boolean(rule.config.delete_current_name ?? false);
  const options = [
    { key: "delete_current_name", label: "rules:delete.currentName", defaultValue: false, disabled: false },
    { key: "ignore_extension", label: "rules:fields.ignoreExtension", defaultValue: true, disabled: false },
    { key: "from_right", label: "rules:delete.fromRight", defaultValue: false, disabled: deleteCurrentName },
    { key: "keep_delimiters", label: "rules:delete.keepDelimiters", defaultValue: false, disabled: deleteCurrentName },
  ] as const;

  return (
    <>
      <Box sx={{ display: "grid", gap: 1.5 }}>
        {deleteBoundaries.map((boundary) => {
          const mode = valueAsString(rule, boundary.modeKey, boundary.numericMode);
          return (
            <Box key={boundary.modeKey} className="rule-fields" sx={ruleFieldsSx}>
              <label>
                {t(boundary.label)}
                <TextField
                  select
                  fullWidth
                  size="small"
                  value={mode}
                  disabled={deleteCurrentName}
                  onChange={(event) => onChange({ [boundary.modeKey]: event.target.value })}
                  slotProps={{ select: { inputProps: { "aria-label": t(boundary.label) } } }}
                >
                  {Object.entries(boundary.options).map(([value, label]) => (
                    <MenuItem key={value} value={value}>{t(label)}</MenuItem>
                  ))}
                </TextField>
              </label>
              {mode === boundary.numericMode && (
                <Box sx={{ alignSelf: "end", minWidth: 0 }}>
                  <NumberField
                    label={t(boundary.numericLabel)}
                    value={Number(rule.config[boundary.numberKey] ?? 1)}
                    min={1}
                    max={255}
                    disabled={deleteCurrentName}
                    onChange={(value) => onChange({ [boundary.numberKey]: value })}
                  />
                </Box>
              )}
              {mode === "delimiter" && (
                <TextField
                  fullWidth
                  size="small"
                  sx={{ alignSelf: "end" }}
                  value={valueAsString(rule, boundary.delimiterKey, "")}
                  disabled={deleteCurrentName}
                  onChange={(event) => onChange({ [boundary.delimiterKey]: event.target.value })}
                  slotProps={{ htmlInput: { "aria-label": t(boundary.delimiterLabel) } }}
                />
              )}
            </Box>
          );
        })}
      </Box>
      <div className="rule-options">
        {options.map(({ key, label, defaultValue, disabled }) => (
          <FormControlLabel
            key={key}
            className="option-toggle"
            sx={{ m: 0, "&.Mui-disabled": { color: "text.disabled" } }}
            label={t(label)}
            disableTypography
            disabled={disabled}
            control={
              <Checkbox
                size="small"
                checked={Boolean(rule.config[key] ?? defaultValue)}
                onChange={(event) => onChange({ [key]: event.target.checked })}
              />
            }
          />
        ))}
      </div>
    </>
  );
}

const maxSequenceInput = 99_999_999;
const numberingSystems = {
  decimal: { labelKey: "rules:serialize.systems.decimal", min: -maxSequenceInput, max: maxSequenceInput },
  alphabetic: { labelKey: "rules:serialize.systems.alphabetic", min: 1, max: maxSequenceInput },
  roman: { labelKey: "rules:serialize.systems.roman", min: 1, max: 3999 },
  music: { labelKey: "rules:serialize.systems.music", min: 1, max: 120 },
  chinese: { labelKey: "rules:serialize.systems.chinese", min: 1, max: 9999 },
} as const;

const serializePositions = {
  prefix: "rules:fields.prefix",
  suffix: "rules:fields.suffix",
  index: "rules:fields.indexPosition",
  replace: "rules:serialize.replaceName",
} as const;

function SerializeNumberField(props: Omit<ComponentProps<typeof NumberField>, "id">) {
  const id = useId();
  return (
    <Box sx={{ display: "grid", gap: "6px", minWidth: 0 }}>
      <label htmlFor={id}>{props.label}</label>
      <NumberField id={id} {...props} />
    </Box>
  );
}

function SerializeFields({ rule, onChange }: RuleFieldsProps) {
  const { t } = useTranslation();
  const systemId = useId();
  const system = (rule.config.numbering_system ?? "decimal") as keyof typeof numberingSystems;
  const { min, max } = numberingSystems[system];
  const showRange = system !== "decimal" && system !== "alphabetic";
  const start = Number(rule.config.start ?? 1);
  const position = valueAsString(rule, "position", "prefix");
  const numberFields = [
    { key: "start", label: t("rules:serialize.start"), min, max, value: start },
    { key: "repeat", label: t("rules:serialize.repeat"), min: 1, max: maxSequenceInput, value: Number(rule.config.repeat ?? 1) },
    { key: "step", label: t("rules:serialize.step"), min: -maxSequenceInput, max: maxSequenceInput, value: Number(rule.config.step ?? 1) },
  ];
  const optionalFields = [
    {
      key: "reset_every", toggle: t("rules:serialize.reset"), label: t("rules:serialize.resetEvery"),
      initial: 10, max: maxSequenceInput, available: true,
    },
    {
      key: "pad_length", toggle: t("rules:serialize.pad"), label: t("rules:serialize.padLength"),
      initial: 3, max: 255, available: system === "decimal",
    },
  ];

  function changeSystem(nextSystem: keyof typeof numberingSystems) {
    const next = numberingSystems[nextSystem];
    onChange({
      numbering_system: nextSystem,
      start: Math.min(next.max, Math.max(next.min, start)),
      ...(nextSystem !== "decimal" && { pad_length: null }),
    });
  }

  return (
    <Box sx={{ display: "grid", gap: "12px" }}>
      <Box className="rule-fields" sx={ruleFieldsSx}>
        <label>
          {t("rules:serialize.numberingSystem")}
          <TextField
            id={systemId}
            select fullWidth size="small" value={system}
            helperText={showRange ? t("rules:serialize.range", { min, max }) : undefined}
            onChange={(event) => changeSystem(event.target.value as keyof typeof numberingSystems)}
            slotProps={{ select: { inputProps: { "aria-label": t("rules:serialize.numberingSystem") } } }}
          >
            {Object.entries(numberingSystems).map(([value, { labelKey }]) => (
              <MenuItem key={value} value={value}>{t(labelKey)}</MenuItem>
            ))}
          </TextField>
        </label>
      </Box>
      <Box className="rule-fields" sx={ruleFieldsSx}>
        {numberFields.map(({ key, ...field }) => (
          <SerializeNumberField key={key} {...field} onChange={(value) => onChange({ [key]: value })} />
        ))}
      </Box>
      <Box className="rule-fields" sx={{ "& .MuiFormControlLabel-root": { display: "inline-flex", m: 0, gap: 0.5 } }}>
        {optionalFields.filter((field) => field.available).map(({ key, toggle, label, initial, max }) => {
          const value = rule.config[key] as number | null | undefined;
          return (
            <Box key={key}>
              <FormControlLabel
                label={toggle}
                slotProps={{ typography: { variant: "caption", sx: { fontWeight: 700 } } }}
                control={
                  <Switch
                    size="small"
                    checked={value != null}
                    onChange={(event) => onChange({ [key]: event.target.checked ? initial : null })}
                  />
                }
              />
              {value != null && <NumberField label={label} min={1} max={max} value={value}
                onChange={(next) => onChange({ [key]: next })} />}
            </Box>
          );
        })}
      </Box>
      <Box className="rule-fields" sx={ruleFieldsSx}>
        <label>
          {t("rules:fields.position")}
          <TextField
            select fullWidth size="small" value={position}
            onChange={(event) => onChange({ position: event.target.value })}
            slotProps={{ select: { inputProps: { "aria-label": t("rules:fields.position") } } }}
          >
            {Object.entries(serializePositions).map(([value, labelKey]) => (
              <MenuItem key={value} value={value}>{t(labelKey)}</MenuItem>
            ))}
          </TextField>
        </label>
        {position === "index" && (
          <SerializeNumberField label={t("rules:fields.index")} min={1} max={255}
            value={Number(rule.config.index ?? 1)} onChange={(index) => onChange({ index })} />
        )}
      </Box>
      <Box className="rule-options" sx={{ mt: 0 }}>
        {position === "index" && (
          <label className="option-toggle">
            <Checkbox size="small" checked={Boolean(rule.config.from_right ?? false)}
              onChange={(event) => onChange({ from_right: event.target.checked })} />
            {t("rules:fields.fromRight")}
          </label>
        )}
        <label className="option-toggle">
          <Checkbox size="small" checked={Boolean(rule.config.ignore_extension ?? true)}
            onChange={(event) => onChange({ ignore_extension: event.target.checked })} />
          {t("rules:fields.ignoreExtension")}
        </label>
      </Box>
    </Box>
  );
}

export function RuleFields(props: RuleFieldsProps & { editorPanelRef: RefObject<HTMLElement> }) {
  const { t } = useTranslation();
  if (props.rule.type === "padding") return <PaddingFields {...props} />;
  if (props.rule.type === "replace" || props.rule.type === "remove") {
    return <TextOperationFields {...props} />;
  }
  if (props.rule.type === "insert") return <InsertFields {...props} />;
  if (props.rule.type === "delete") return <DeleteFields {...props} />;
  if (props.rule.type === "serialize") return <SerializeFields {...props} />;
  if (props.rule.type === "user_input") return <UserInputFields {...props} />;
  return <Alert severity="error">{t("rules:unsupported", { type: props.rule.type })}</Alert>;
}
