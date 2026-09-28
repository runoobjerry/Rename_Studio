import AddRoundedIcon from "@mui/icons-material/AddRounded";
import RemoveRoundedIcon from "@mui/icons-material/RemoveRounded";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";

import type { RuleSpec } from "../../types";


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
  const updateValue = (nextValue: number) => {
    onChange(Math.min(max, Math.max(min, nextValue)));
  };

  return (
    <div className="number-stepper" role="group" aria-label={label}>
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
        value={value}
        onChange={(event) => updateValue(Number(event.target.value))}
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
    </div>
  );
}

function PaddingFields({ rule, onChange }: RuleFieldsProps) {
  const mode = valueAsString(rule, "mode", "number");

  return (
    <div className="rule-fields">
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
            <input
              value={valueAsString(rule, "fill_character", "_")}
              maxLength={1}
              onChange={(event) => onChange({ fill_character: event.target.value })}
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
    </div>
  );
}

function TextOperationFields({ rule, onChange }: RuleFieldsProps) {
  const isReplace = rule.type === "replace";

  return (
    <>
      <div className="rule-fields">
        <label>
          {isReplace ? "查找内容" : "移除内容"}
          <input
            value={valueAsString(rule, "search", "")}
            onChange={(event) => onChange({ search: event.target.value })}
          />
        </label>
        {isReplace && (
          <label>
            替换为
            <input
              value={valueAsString(rule, "replacement", "")}
              onChange={(event) => onChange({ replacement: event.target.value })}
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
      </div>
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
      <div className="rule-fields">
        <label>
          插入内容
          <input
            value={valueAsString(rule, "text", "")}
            onChange={(event) => onChange({ text: event.target.value })}
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
            <MenuItem value="index">第几个字符位置</MenuItem>
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
            <input
              value={valueAsString(rule, "anchor", "")}
              onChange={(event) => onChange({ anchor: event.target.value })}
            />
          </label>
        )}
      </div>
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
  return <p className="error-banner">不支持的规则类型：{props.rule.type}</p>;
}
