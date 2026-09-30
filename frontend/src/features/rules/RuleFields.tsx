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
        aria-label={`${label}减一`}
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
        aria-label={`${label}加一`}
      >
        <AddRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

function PaddingFields({ rule, onChange }: RuleFieldsProps) {
  const mode = valueAsString(rule, "mode", "number");

  return (
    <Box className="rule-fields" sx={ruleFieldsSx}>
      <label>
        填充类型
        <TextField
          select
          fullWidth
          size="small"
          value={mode}
          onChange={(event) => onChange({ mode: event.target.value })}
          slotProps={{ select: { inputProps: { "aria-label": "填充类型" } } }}
        >
          <MenuItem value="number">数字序列补零</MenuItem>
          <MenuItem value="text">文本填充</MenuItem>
        </TextField>
      </label>
      <label>
        目标长度
        <NumberStepper
          label="目标长度"
          min={1}
          max={255}
          value={Number(rule.config.length ?? 3)}
          onChange={(value) => onChange({ length: value })}
        />
      </label>
      {mode === "text" && (
        <>
          <label>
            填充字符
            <TextField
              fullWidth
              hiddenLabel
              size="small"
              value={valueAsString(rule, "fill_character", "_")}
              onChange={(event) => onChange({ fill_character: event.target.value })}
              slotProps={{ htmlInput: { maxLength: 1, "aria-label": "填充字符" } }}
            />
          </label>
          <label>
            填充位置
            <TextField
              select
              fullWidth
              size="small"
              value={valueAsString(rule, "side", "left")}
              onChange={(event) => onChange({ side: event.target.value })}
              slotProps={{ select: { inputProps: { "aria-label": "填充位置" } } }}
            >
              <MenuItem value="left">从左侧填充</MenuItem>
              <MenuItem value="right">从右侧填充</MenuItem>
            </TextField>
          </label>
        </>
      )}
    </Box>
  );
}

function TextOperationFields({ rule, onChange }: RuleFieldsProps) {
  const isReplace = rule.type === "replace";

  return (
    <>
      <Box className="rule-fields" sx={ruleFieldsSx}>
        <label>
          {isReplace ? "查找内容" : "移除内容"}
          <TextField
            fullWidth
            hiddenLabel
            size="small"
            value={valueAsString(rule, "search", "")}
            onChange={(event) => onChange({ search: event.target.value })}
            slotProps={{
              htmlInput: { "aria-label": isReplace ? "查找内容" : "移除内容" },
            }}
          />
        </label>
        {isReplace && (
          <label>
            替换为
            <TextField
              fullWidth
              hiddenLabel
              size="small"
              value={valueAsString(rule, "replacement", "")}
              onChange={(event) => onChange({ replacement: event.target.value })}
              slotProps={{ htmlInput: { "aria-label": "替换为" } }}
            />
          </label>
        )}
        <label>
          操作序数
          <TextField
            select
            fullWidth
            size="small"
            value={valueAsString(rule, "occurrence", "all")}
            onChange={(event) => onChange({ occurrence: event.target.value })}
            slotProps={{ select: { inputProps: { "aria-label": "操作序数" } } }}
          >
            <MenuItem value="all">全部</MenuItem>
            <MenuItem value="first">首个</MenuItem>
            <MenuItem value="last">末个</MenuItem>
          </TextField>
        </label>
      </Box>
      <div className="rule-options">
        <label className="option-toggle">
          <Checkbox
            size="small"
            checked={Boolean(rule.config.case_sensitive ?? true)}
            onChange={(event) => onChange({ case_sensitive: event.target.checked })}
            slotProps={{ input: { "aria-label": "区分大小写" } }}
          />
          区分大小写
        </label>
        <label className="option-toggle">
          <Checkbox
            size="small"
            checked={Boolean(rule.config.whole_word ?? false)}
            onChange={(event) => onChange({ whole_word: event.target.checked })}
            slotProps={{ input: { "aria-label": "仅全字匹配" } }}
          />
          仅全字匹配
        </label>
        <label className="option-toggle">
          <Checkbox
            size="small"
            checked={Boolean(rule.config.ignore_extension ?? true)}
            onChange={(event) => onChange({ ignore_extension: event.target.checked })}
            slotProps={{ input: { "aria-label": "忽略扩展名" } }}
          />
          忽略扩展名
        </label>
      </div>
    </>
  );
}

function InsertFields({ rule, onChange }: RuleFieldsProps) {
  const position = valueAsString(rule, "position", "prefix");
  const usesIndex = position === "index";
  const usesAnchor = position === "before_text" || position === "after_text";

  return (
    <>
      <Box className="rule-fields" sx={ruleFieldsSx}>
        <label>
          插入内容
          <TextField
            fullWidth
            hiddenLabel
            size="small"
            value={valueAsString(rule, "text", "")}
            onChange={(event) => onChange({ text: event.target.value })}
            slotProps={{ htmlInput: { "aria-label": "插入内容" } }}
          />
        </label>
        <label>
          插入位置
          <TextField
            select
            fullWidth
            size="small"
            value={position}
            onChange={(event) => onChange({ position: event.target.value })}
            slotProps={{ select: { inputProps: { "aria-label": "插入位置" } } }}
          >
            <MenuItem value="prefix">前缀</MenuItem>
            <MenuItem value="suffix">后缀</MenuItem>
            <MenuItem value="index">指定字符位置</MenuItem>
            <MenuItem value="before_text">指定文本之前</MenuItem>
            <MenuItem value="after_text">指定文本之后</MenuItem>
          </TextField>
        </label>
        {usesIndex && (
          <label>
            字符位置
            <NumberStepper
              label="字符位置"
              min={1}
              max={255}
              value={Number(rule.config.index ?? 1)}
              onChange={(value) => onChange({ index: value })}
            />
          </label>
        )}
        {usesAnchor && (
          <label>
            指定文本
            <TextField
              fullWidth
              hiddenLabel
              size="small"
              value={valueAsString(rule, "anchor", "")}
              onChange={(event) => onChange({ anchor: event.target.value })}
              slotProps={{ htmlInput: { "aria-label": "指定文本" } }}
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
              slotProps={{ input: { "aria-label": "从右往左计数" } }}
            />
            从右往左计数
          </label>
        </div>
      )}
    </>
  );
}

export function RuleFields(props: RuleFieldsProps) {
  if (props.rule.type === "padding") return <PaddingFields {...props} />;
  if (props.rule.type === "replace" || props.rule.type === "remove") {
    return <TextOperationFields {...props} />;
  }
  if (props.rule.type === "insert") return <InsertFields {...props} />;
  return <Alert severity="error">不支持的规则类型：{props.rule.type}</Alert>;
}
