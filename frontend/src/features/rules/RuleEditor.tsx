import { useTranslation } from "react-i18next";
import { lazy, Suspense, useId, useLayoutEffect, useRef, useState } from "react";
import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DeleteSweepRoundedIcon from "@mui/icons-material/DeleteSweepRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
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

const RuleParameterCard = lazy(() =>
  import("./RuleParameterCard").then((module) => ({ default: module.RuleParameterCard })),
);

const ruleActionSx = { width: 30, height: 30, p: "5px" } as const;

interface RuleEditorProps {
  definitions: RuleDefinition[];
  rules: RuleSpec[];
  onChange: (rules: RuleSpec[]) => void;
  isLoading?: boolean;
  compact?: {
    confirmDisabled: boolean;
    onConfirm: (rules: RuleSpec[]) => void;
  };
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
  delete: {
    type: "delete",
    enabled: true,
    config: {
      from_mode: "position",
      from_position: 1,
      from_delimiter: "",
      until_mode: "count",
      until_count: 1,
      until_delimiter: "",
      delete_current_name: false,
      ignore_extension: true,
      from_right: false,
      keep_delimiters: false,
    },
  },
  case: {
    type: "case",
    enabled: true,
    config: {
      mode: "capitalize_words",
      fragments: "",
      preserve_case: false,
      ignore_extension: true,
      extension_case: "none",
    },
  },
  serialize: {
    type: "serialize",
    enabled: true,
    config: {
      numbering_system: "decimal",
      start: 1,
      repeat: 1,
      step: 1,
      reset_every: null,
      pad_length: null,
      position: "prefix",
      index: 1,
      from_right: false,
      ignore_extension: true,
    },
  },
  user_input: {
    type: "user_input",
    enabled: true,
    config: {
      text: "",
      position: "replace",
      ignore_extension: true,
    },
  },
};

export function cloneRule(rule: RuleSpec): RuleSpec {
  return { ...rule, config: { ...rule.config } };
}

export function RuleEditor({ definitions, rules, onChange, isLoading = false, compact }: RuleEditorProps) {
  const { t } = useTranslation();
  const menuId = useId();
  const parameterCardId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [editingKey, setEditingKey] = useState<number | null>(null);
  const identities = useRef({ keys: new WeakMap<RuleSpec, number>(), nextKey: 0 });
  const availableRules = definitions.filter(
    (definition) => DEFAULT_RULES[definition.type] !== undefined,
  );

  function ruleKey(rule: RuleSpec): number {
    let key = identities.current.keys.get(rule);
    if (key === undefined) {
      key = identities.current.nextKey++;
      identities.current.keys.set(rule, key);
    }
    return key;
  }

  const editingIndex = compact && editingKey !== null ? rules.findIndex((rule) => ruleKey(rule) === editingKey) : -1;
  const editingRule = rules[editingIndex];
  const isEditing = editingRule !== undefined;

  useLayoutEffect(() => {
    listRef.current!.inert = isEditing;
    if (!isEditing) {
      const button = editButtonRef.current;
      editButtonRef.current = null;
      if (editingKey === null) button?.focus();
      else setEditingKey(null);
    }
  }, [editingKey, isEditing]);

  function replaceRule(index: number, nextRule: RuleSpec): RuleSpec[] {
    // 编辑延续原身份；复制和父组件传入的新对象获得新身份，不按位置或内容猜测。
    identities.current.keys.set(nextRule, ruleKey(rules[index]));
    return rules.map((rule, ruleIndex) => (ruleIndex === index ? nextRule : rule));
  }

  function updateRule(index: number, nextRule: RuleSpec) {
    onChange(replaceRule(index, nextRule));
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
    return t(`rules:types.${type}.name`, { defaultValue: type });
  }

  return (
    <section ref={panelRef} className="rule-editor-panel" aria-labelledby="rules-title">
      <div className="panel-heading rule-editor-heading">
        <h2 id="rules-title">{t("rules:editor.title")}</h2>
        <div className="rule-heading-actions">
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<DeleteSweepRoundedIcon />}
            onClick={() => onChange([])}
            disabled={rules.length === 0}
          >
            {t("rules:editor.clear")}
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
          >
            {t("rules:editor.add")}
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
          <Tooltip key={definition.type} title={t(`rules:types.${definition.type}.description`, { defaultValue: definition.type })} placement="left" describeChild>
            <MenuItem
              dense
              onClick={() => {
                onChange([...rules, cloneRule(DEFAULT_RULES[definition.type])]);
                setAnchor(null);
              }}
            >
              {ruleName(definition.type)}
            </MenuItem>
          </Tooltip>
        ))}
      </Menu>
      <div className={editingRule ? "panel rule-editor-content rule-editor-content-editing" : "panel rule-editor-content"}>
        {isLoading ? (
          <div className="notice" role="status" aria-label={t("rules:editor.loading")}>
            <Skeleton height={28} />
            <Skeleton width="70%" height={28} />
          </div>
        ) : availableRules.length === 0 ? (
          <div className="notice">
            <strong>{t("rules:editor.unavailable")}</strong>
            <p>{t("rules:editor.checkRegistry")}</p>
          </div>
        ) : rules.length === 0 ? (
          <p className="empty-state">{t("rules:editor.empty")}</p>
        ) : null}

        <div ref={listRef} className="rule-list">
          {rules.map((rule, index) => (
            <article className="rule-card" key={ruleKey(rule)}>
              <header className="rule-card-heading">
                <h3>{ruleName(rule.type)}</h3>
                <span className="rule-card-number">{String(index + 1).padStart(2, "0")}</span>
              </header>

              {!compact && (
                <RuleFields
                  rule={rule}
                  editorPanelRef={panelRef}
                  onChange={(values) => updateConfig(index, values)}
                />
              )}

              <footer className="rule-card-footer">
                <Switch
                  size="small"
                  checked={rule.enabled}
                  onChange={(event) =>
                    updateRule(index, { ...rule, enabled: event.target.checked })
                  }
                  slotProps={{ input: { "aria-label": t("rules:editor.enabledLabel", { name: ruleName(rule.type) }) } }}
                />
                <div className="rule-actions">
                  {compact && (
                    <Tooltip title={t("rules:editor.editParameters")}>
                      <IconButton
                        size="small"
                        aria-label={t("rules:editor.editParameters")}
                        aria-expanded={editingIndex === index}
                        aria-controls={editingIndex === index ? parameterCardId : undefined}
                        onClick={(event) => {
                          editButtonRef.current = event.currentTarget;
                          setEditingKey(ruleKey(rule));
                        }}
                        sx={ruleActionSx}
                      >
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title={t("rules:editor.moveUp")}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={index === 0}
                        onClick={() => moveRule(index, -1)}
                        aria-label={t("rules:editor.moveUp")}
                        sx={ruleActionSx}
                      >
                        <ArrowUpwardRoundedIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t("rules:editor.moveDown")}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={index === rules.length - 1}
                        onClick={() => moveRule(index, 1)}
                        aria-label={t("rules:editor.moveDown")}
                        sx={ruleActionSx}
                      >
                        <ArrowDownwardRoundedIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t("rules:editor.copy")}>
                    <IconButton
                      size="small"
                      onClick={() => onChange([...rules, cloneRule(rule)])}
                      aria-label={t("rules:editor.copy")}
                      sx={ruleActionSx}
                    >
                      <ContentCopyRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t("rules:editor.remove")}>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() =>
                        onChange(rules.filter((_, itemIndex) => itemIndex !== index))
                      }
                      aria-label={t("rules:editor.remove")}
                      sx={ruleActionSx}
                    >
                      <DeleteOutlineRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </div>
              </footer>
            </article>
          ))}
        </div>
        {compact && editingRule && (
          <Suspense fallback={
            <div className="rule-parameter-card" role="status" aria-label={t("rules:editor.loading")}>
              <Skeleton height={30} sx={{ mx: 1.5, my: 1 }} />
            </div>
          }>
            <RuleParameterCard
              id={parameterCardId}
              name={ruleName(editingRule.type)}
              rule={editingRule}
              editorPanelRef={panelRef}
              confirmDisabled={compact.confirmDisabled}
              onConfirm={(config) => compact.onConfirm(config === editingRule.config
                ? rules : replaceRule(editingIndex, { ...editingRule, config }))}
              onCollapse={() => setEditingKey(null)}
            />
          </Suspense>
        )}
      </div>
    </section>
  );
}
