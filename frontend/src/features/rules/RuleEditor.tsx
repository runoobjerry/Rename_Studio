import type { RuleDefinition, RuleSpec } from "../../types";

interface RuleEditorProps {
  definitions: RuleDefinition[];
  rules: RuleSpec[];
  onChange: (rules: RuleSpec[]) => void;
}

const DEFAULT_PADDING_RULE: RuleSpec = {
  type: "padding",
  enabled: true,
  config: {
    mode: "number",
    length: 3,
    fill_character: "_",
    side: "left",
  },
};

export function RuleEditor({ definitions, rules, onChange }: RuleEditorProps) {
  const paddingAvailable = definitions.some((item) => item.type === "padding");

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

  return (
    <section className="panel" aria-labelledby="rules-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Rule chain</p>
          <h2 id="rules-title">重命名规则</h2>
        </div>
        <button
          className="secondary-button"
          disabled={!paddingAvailable}
          onClick={() =>
            onChange([
              ...rules,
              { ...DEFAULT_PADDING_RULE, config: { ...DEFAULT_PADDING_RULE.config } },
            ])
          }
        >
          + 添加填充
        </button>
      </div>
      {!paddingAvailable ? (
        <div className="notice">
          <strong>规则接口已就绪</strong>
          <p>后端没有返回可用的填充规则。</p>
        </div>
      ) : rules.length === 0 ? (
        <p className="empty-state">添加规则后，可配置数字补零或文本填充。</p>
      ) : null}

      <div className="rule-list">
        {rules.map((rule, index) => {
          const mode = String(rule.config.mode ?? "number");
          const length = Number(rule.config.length ?? 3);
          const fillCharacter = String(rule.config.fill_character ?? "_");
          const side = String(rule.config.side ?? "left");

          return (
            <article className="rule-card" key={`${rule.type}-${index}`}>
              <div className="rule-card-heading">
                <label>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(event) =>
                      updateRule(index, { ...rule, enabled: event.target.checked })
                    }
                  />
                  <strong>{index + 1}. 填充</strong>
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
                  <button
                    onClick={() =>
                      onChange([
                        ...rules,
                        { ...rule, config: { ...rule.config } },
                      ])
                    }
                  >
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

              <div className="rule-fields">
                <label>
                  填充类型
                  <select
                    value={mode}
                    onChange={(event) =>
                      updateConfig(index, { mode: event.target.value })
                    }
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
                    value={length}
                    onChange={(event) =>
                      updateConfig(index, { length: Number(event.target.value) })
                    }
                  />
                </label>
                {mode === "text" && (
                  <>
                    <label>
                      填充字符
                      <input
                        value={fillCharacter}
                        maxLength={1}
                        onChange={(event) =>
                          updateConfig(index, { fill_character: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      填充位置
                      <select
                        value={side}
                        onChange={(event) =>
                          updateConfig(index, { side: event.target.value })
                        }
                      >
                        <option value="left">从左侧填充</option>
                        <option value="right">从右侧填充</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
