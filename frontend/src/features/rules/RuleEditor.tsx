import Switch from "@mui/material/Switch";

import type { RuleDefinition, RuleSpec } from "../../types";
import { RuleFields } from "./RuleFields";

interface RuleEditorProps {
  definitions: RuleDefinition[];
  rules: RuleSpec[];
  onChange: (rules: RuleSpec[]) => void;
  onAddRule?: () => void;
}

export const DEFAULT_RULES: Record<string, RuleSpec> = {
  padding: {
    type: "padding",
    enabled: true,
    config: {
      mode: "number",
      length: 3,
      fill_character: "_",
      side: "left",
    },
  },
  replace: {
    type: "replace",
    enabled: true,
    config: {
      search: "",
      replacement: "",
      occurrence: "all",
      case_sensitive: true,
      whole_word: false,
      ignore_extension: true,
    },
  },
  remove: {
    type: "remove",
    enabled: true,
    config: {
      search: "",
      occurrence: "all",
      case_sensitive: true,
      whole_word: false,
      ignore_extension: true,
    },
  },
  insert: {
    type: "insert",
    enabled: true,
    config: {
      text: "",
      position: "prefix",
      index: 1,
      from_right: false,
      anchor: "",
    },
  },
};

export function cloneRule(rule: RuleSpec): RuleSpec {
  return { ...rule, config: { ...rule.config } };
}

export function RuleEditor({ definitions, rules, onChange, onAddRule }: RuleEditorProps) {
  const availableRules = definitions.filter(
    (definition) => DEFAULT_RULES[definition.type] !== undefined,
  );

  function updateRule(index: number, nextRule: RuleSpec) {
    onChange(
      rules.map((rule, ruleIndex) => (ruleIndex === index ? nextRule : rule)),
    );
  }

  function updateConfig(index: number, values: Record<string, unknown>) {
    updateRule(index, {
      ...rules[index],
      config: { ...rules[index].config, ...values },
    });
  }

  function moveRule(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function ruleName(type: string): string {
    return (
      definitions.find((definition) => definition.type === type)?.name ?? type
    );
  }

  return (
    <section className="panel rule-editor-panel" aria-labelledby="rules-title">
      <div className="panel-heading rule-editor-heading">
        <div>
          <p className="eyebrow">Rule chain</p>
          <h2 id="rules-title">重命名规则</h2>
        </div>
        <button
          className="secondary-button add-rule-button"
          type="button"
          onClick={onAddRule}
          disabled={availableRules.length === 0 || !onAddRule}
        >
          ＋ 添加规则
        </button>
      </div>
      {availableRules.length === 0 ? (
        <div className="notice">
          <strong>暂无可用规则</strong>
          <p>请确认后端规则注册表已经加载。</p>
        </div>
      ) : rules.length === 0 ? (
        <p className="empty-state">添加规则后即可组合生成重命名预览。</p>
      ) : null}

      <div className="rule-list">
        {rules.map((rule, index) => (
          <article className="rule-card" key={`${rule.type}-${index}`}>
            <div className="rule-card-heading">
              <label className="rule-enabled-control">
                <Switch
                  size="small"
                  checked={rule.enabled}
                  onChange={(event) =>
                    updateRule(index, { ...rule, enabled: event.target.checked })
                  }
                  slotProps={{ input: { "aria-label": `${ruleName(rule.type)}启用状态` } }}
                />
                <strong>
                  {index + 1}. {ruleName(rule.type)}
                </strong>
              </label>
              <div className="rule-actions">
                <button
                  disabled={index === 0}
                  onClick={() => moveRule(index, -1)}
                  aria-label="上移规则"
                >
                  ↑
                </button>
                <button
                  disabled={index === rules.length - 1}
                  onClick={() => moveRule(index, 1)}
                  aria-label="下移规则"
                >
                  ↓
                </button>
                <button onClick={() => onChange([...rules, cloneRule(rule)])}>
                  复制
                </button>
                <button
                  onClick={() =>
                    onChange(
                      rules.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  删除
                </button>
              </div>
            </div>

            <RuleFields
              rule={rule}
              onChange={(values) => updateConfig(index, values)}
            />
          </article>
        ))}
      </div>
    </section>
  );
}
