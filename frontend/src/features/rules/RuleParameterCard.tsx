import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { animate } from "motion/mini";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";

import type { RuleSpec } from "../../types";
import { RuleFields } from "./RuleFields";

const hiddenCard = { transform: "translateY(100%)", opacity: 0 };
const reducedMotion = "(prefers-reduced-motion: reduce)";

interface RuleParameterCardProps {
  id: string;
  name: string;
  rule: RuleSpec;
  editorPanelRef: RefObject<HTMLElement>;
  confirmDisabled: boolean;
  onConfirm: (config: RuleSpec["config"]) => void;
  onCollapse: () => void;
}

export function RuleParameterCard({
  id, name, rule, editorPanelRef, confirmDisabled, onConfirm, onCollapse,
}: RuleParameterCardProps) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLElement>(null);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const [config, setConfig] = useState(rule.config);

  useLayoutEffect(() => {
    const card = cardRef.current!;
    card.focus({ preventScroll: true });
    if (!window.matchMedia(reducedMotion).matches) {
      animationRef.current = animate(card, {
        transform: [hiddenCard.transform, "translateY(0)"],
        opacity: [hiddenCard.opacity, 1],
      }, { duration: 0.34, ease: [0.2, 0.8, 0.2, 1] });
    }
    return () => {
      const animation = animationRef.current;
      animationRef.current = null;
      animation?.stop();
    };
  }, []);

  function collapse() {
    const card = cardRef.current!;
    if (window.matchMedia(reducedMotion).matches) {
      onCollapse();
      return;
    }

    card.inert = true;
    const animation = animate(card, hiddenCard, { duration: 0.24, ease: "easeIn" });
    animationRef.current = animation;
    void animation.then(() => {
      if (animationRef.current === animation) onCollapse();
    });
  }

  return (
    <section
      ref={cardRef}
      id={id}
      className="rule-parameter-card"
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
    >
      <header className="rule-parameter-heading">
        <h3 id={`${id}-title`}>{name}</h3>
        <Button
          size="small"
          variant="contained"
          disabled={confirmDisabled}
          onPointerDown={(event) => {
            // 数值字段在失焦时修正输入，须在应用参数前写入草稿。
            event.currentTarget.focus({ preventScroll: true });
          }}
          onClick={() => onConfirm(config)}
        >
          {t("common:apply")}
        </Button>
        <Tooltip title={t("rules:editor.collapseParameters")}>
          <IconButton size="small" aria-label={t("rules:editor.collapseParameters")} onClick={collapse}>
            <KeyboardArrowDownRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </header>
      <div className="rule-parameter-fields">
        <RuleFields
          rule={{ ...rule, config }}
          editorPanelRef={editorPanelRef}
          onChange={(values) => setConfig((current) => ({ ...current, ...values }))}
        />
      </div>
    </section>
  );
}
