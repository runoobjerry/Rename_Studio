import { useId, useState } from "react";
import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DeleteSweepRoundedIcon from "@mui/icons-material/DeleteSweepRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Skeleton from "@mui/material/Skeleton";

import type { RuleDefinition, RuleSpec } from "../../types";
import { RuleFields } from "./RuleFields";
import { MENU_METRICS } from "../../theme";

const ruleActionSx = { width: 30, height: 30, p: "5px" } as const;

interface RuleEditorProps {
  definitions: RuleDefinition[];
  rules: RuleSpec[];
  onChange: (rules: RuleSpec[]) => void;
  isLoading?: boolean;
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

export function RuleEditor({ definitions, rules, onChange, isLoading = false }: RuleEditorProps) {
  const menuId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
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
        <h2 id="rules-title">规则编辑</h2>
        <div className="rule-heading-actions">
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<DeleteSweepRoundedIcon />}
            onClick={() => onChange([])}
            disabled={rules.length === 0}
            sx={{ flex: { xs: 1, sm: "initial" } }}
          >
            一键清除
          </Button>
          <Button
            id={`${menuId}-button`}
            size="small"
            variant="contained"
            startIcon={<AddRoundedIcon />}
            aria-haspopup="menu"
            aria-expanded={Boolean(anchor)}
            aria-controls={anchor ? `${menuId}-menu` : undefined}
            onClick={(event) => setAnchor(event.currentTarget)}
            disabled={isLoading || availableRules.length === 0}
            sx={{ flex: { xs: 1, sm: "initial" } }}
          >
            添加规则
          </Button>
        </div>
      </div>
      <Menu
        id={`${menuId}-menu`}
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: { sx: { minWidth: 96, maxWidth: "calc(100vw - 32px)" } },
          // 八项高度加上共享边缘留白、七处项间距，不截断可添加的规则。
          list: {
            "aria-labelledby": `${menuId}-button`, dense: true,
            sx: { maxHeight: MENU_METRICS.inset * 2 + MENU_METRICS.itemHeight * 8 + MENU_METRICS.gap * 7, overflowY: "auto", "& .MuiMenuItem-root": {justifyContent: "center",textAlign: "center", }, },
          },
        }}
      >
        {availableRules.map((definition) => (
          <Tooltip key={definition.type} title={definition.description} placement="left" describeChild>
            <MenuItem
              dense
              onClick={() => {
                onChange([...rules, cloneRule(DEFAULT_RULES[definition.type])]);
                setAnchor(null);
              }}
            >
              {definition.name}
            </MenuItem>
          </Tooltip>
        ))}
      </Menu>
      {isLoading ? (
        <div className="notice" role="status" aria-label="正在加载规则">
          <Skeleton height={28} />
          <Skeleton width="70%" height={28} />
        </div>
      ) : availableRules.length === 0 ? (
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
                <Tooltip title="上移规则">
                  <span>
                    <IconButton
                      size="small"
                      disabled={index === 0}
                      onClick={() => moveRule(index, -1)}
                      aria-label="上移规则"
                      sx={ruleActionSx}
                    >
                      <ArrowUpwardRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="下移规则">
                  <span>
                    <IconButton
                      size="small"
                      disabled={index === rules.length - 1}
                      onClick={() => moveRule(index, 1)}
                      aria-label="下移规则"
                      sx={ruleActionSx}
                    >
                      <ArrowDownwardRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="复制规则">
                  <IconButton
                    size="small"
                    onClick={() => onChange([...rules, cloneRule(rule)])}
                    aria-label="复制规则"
                    sx={ruleActionSx}
                  >
                    <ContentCopyRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="删除规则">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() =>
                      onChange(rules.filter((_, itemIndex) => itemIndex !== index))
                    }
                    aria-label="删除规则"
                    sx={ruleActionSx}
                  >
                    <DeleteOutlineRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
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
