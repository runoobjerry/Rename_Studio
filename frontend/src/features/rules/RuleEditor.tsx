import type { RuleDefinition, RuleSpec } from "../../types";

interface RuleEditorProps {
  definitions: RuleDefinition[];
  rules: RuleSpec[];
}

export function RuleEditor({ definitions, rules }: RuleEditorProps) {
  return (
    <section className="panel" aria-labelledby="rules-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Rule chain</p>
          <h2 id="rules-title">重命名规则</h2>
        </div>
        <span className="count">{rules.length}</span>
      </div>
      {definitions.length === 0 ? (
        <div className="notice">
          <strong>规则接口已就绪</strong>
          <p>具体规则待定义。目前空规则链会保留原文件名，可用于验证安全预览。</p>
        </div>
      ) : (
        <p>{definitions.length} 个规则可用。</p>
      )}
    </section>
  );
}
