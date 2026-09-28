import Checkbox from "@mui/material/Checkbox";

import type { RuleSpec } from "../../types";


interface RuleFieldsProps {
  rule: RuleSpec;
  onChange: (values: Record<string, unknown>) => void;
}

function valueAsString(rule: RuleSpec, key: string, fallback: string): string {
  return String(rule.config[key] ?? fallback);
}

function PaddingFields({ rule, onChange }: RuleFieldsProps) {
  const mode = valueAsString(rule, "mode", "number");

  return (
    <div className="rule-fields">
      <label>
        填充类型
        <select
          value={mode}
          onChange={(event) => onChange({ mode: event.target.value })}
        >
          <option value="number">数字序列补零</option>
          <option value="text">文本填充</option>
        </select>
      </label>
      <label>
        目标长度
        <input
          type="number"
          min="1"
          max="255"
          value={Number(rule.config.length ?? 3)}
          onChange={(event) => onChange({ length: Number(event.target.value) })}
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
            <select
              value={valueAsString(rule, "side", "left")}
              onChange={(event) => onChange({ side: event.target.value })}
            >
              <option value="left">从左侧填充</option>
              <option value="right">从右侧填充</option>
            </select>
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
          <select
            value={valueAsString(rule, "occurrence", "all")}
            onChange={(event) => onChange({ occurrence: event.target.value })}
          >
            <option value="all">全部</option>
            <option value="first">首个</option>
            <option value="last">末个</option>
          </select>
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
          <select
            value={position}
            onChange={(event) => onChange({ position: event.target.value })}
          >
            <option value="prefix">前缀</option>
            <option value="suffix">后缀</option>
            <option value="index">第几个字符位置</option>
            <option value="before_text">指定文本之前</option>
            <option value="after_text">指定文本之后</option>
          </select>
        </label>
        {usesIndex && (
          <label>
            字符位置
            <input
              type="number"
              min="1"
              max="255"
              value={Number(rule.config.index ?? 1)}
              onChange={(event) => onChange({ index: Number(event.target.value) })}
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
