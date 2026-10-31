import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PreviewRoundedIcon from "@mui/icons-material/PreviewRounded";
import {
  Button,
  CircularProgress,
  Dialog,
  Typography,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  LinearProgress,
} from "@mui/material";

import type { PreviewResponse, RenameProgress } from "../../types";
import { errorMessage } from "../../i18n/messages";

export interface RenameActionsProps {
  preview?: PreviewResponse;
  providerName: string;
  selectedCount: number;
  isPreviewing: boolean;
  isExecuting: boolean;
  isBlocked?: boolean;
  isPreviewBlocked?: boolean;
  hasExecuted: boolean;
  progress?: RenameProgress;
  progressError?: string;
  executeError?: string;
  revalidationError?: string;
  hasUnknownOutcome?: boolean;
  onPreview: () => void;
  onExecute: (previewId: string) => void;
}

export function RenameActions({
  preview,
  providerName,
  selectedCount,
  isPreviewing,
  isExecuting,
  isBlocked = false,
  isPreviewBlocked = isBlocked,
  hasExecuted,
  progress,
  progressError,
  executeError,
  revalidationError,
  hasUnknownOutcome = false,
  onPreview,
  onExecute,
}: RenameActionsProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [applied, setApplied] = useState(false);
  const changedCount = preview?.items.filter((item) => item.changed).length ?? 0;
  const currentProgress = progress?.preview_id === preview?.preview_id ? progress : undefined;
  const total = currentProgress?.total ?? changedCount;
  const processed = hasExecuted ? total : currentProgress?.processed ?? 0;
  const percent = total > 0 ? Math.min(100, Math.floor(processed / total * 100)) : 0;
  const started = applied || isExecuting || hasExecuted || Boolean(executeError || revalidationError);
  const executionError = revalidationError ?? executeError ?? (currentProgress?.error ? errorMessage({ message: currentProgress.error }, t) : undefined);
  const phase = hasExecuted ? "finished" : hasUnknownOutcome && executionError ? "unknown"
    : executionError ? "failed" : currentProgress?.phase ?? (applied || isExecuting ? "submitting" : "waiting");
  const isFailed = phase === "failed" || phase === "unknown";

  useEffect(() => {
    setConfirming(false);
    setApplied(false);
  }, [preview?.preview_id]);
  useEffect(() => {
    if (!hasExecuted) return;
    // 收到真实执行结果后短暂展示 100%，再关闭确认卡片。
    const timer = window.setTimeout(() => setConfirming(false), 600);
    return () => window.clearTimeout(timer);
  }, [hasExecuted]);

  return (
    <>
      <Stack direction="row" spacing={1.25} className="rename-action-bar">
        <Button
          fullWidth
          variant="outlined"
          startIcon={isPreviewing ? <CircularProgress size={16} color="inherit" /> : <PreviewRoundedIcon />}
          disabled={selectedCount === 0 || isPreviewing || isExecuting || isPreviewBlocked}
          onClick={onPreview}
        >
          {isPreviewing ? t("files:rename.refreshing") : t("files:rename.preview")}
        </Button>
        <Button
          fullWidth
          variant="contained"
          startIcon={<PlayArrowRoundedIcon />}
          disabled={!preview?.valid || changedCount === 0 || isExecuting || hasExecuted || isBlocked}
          onClick={() => { setApplied(false); setConfirming(true); }}
        >
          {t("files:rename.start")}
        </Button>
      </Stack>

      <Dialog open={confirming} onClose={() => {
        if (!isExecuting && !revalidationError) setConfirming(false);
      }}>
        <DialogTitle>{t(`files:rename.phases.${phase}`)}</DialogTitle>
        <DialogContent>
          <div style={{ position: "relative" }}>
            {/* 保留确认文案占位，状态切换时弹窗尺寸保持不变。 */}
            <DialogContentText sx={{ visibility: started ? "hidden" : "visible" }}>
              {t("files:rename.confirm", { provider: providerName, count: changedCount })}
              <Typography component="span" variant="inherit" sx={{ color: "error.main" }}>{t("files:rename.irreversible")}</Typography>
            </DialogContentText>
            {started && !hasExecuted && (
              <DialogContentText role="status" sx={{ position: "absolute", inset: 0, overflowY: "auto",
                color: executionError || (isExecuting && progressError) ? "error.main" : "text.secondary" }}>
                {hasUnknownOutcome && executionError ? t("files:rename.unknownOutcome")
                  : revalidationError ?? (executionError ? t("files:rename.returnedError", { message: executionError }) : isExecuting && progressError
                  ? t("files:rename.progressUnavailable", { message: progressError })
                  : t("files:rename.processed", { processed, total }))}
              </DialogContentText>
            )}
          </div>
        </DialogContent>
        <DialogActions>
          {revalidationError ? (
            <Button disabled={selectedCount === 0 || isPreviewing || isExecuting || isPreviewBlocked}
              onClick={() => { setConfirming(false); onPreview(); }}>
              {t("files:rename.preview")}
            </Button>
          ) : (
            <>
              <Button disabled={isExecuting} onClick={() => setConfirming(false)}>
                {isFailed ? t("common:close") : t("common:cancel")}
              </Button>
              {!isFailed && (
                <Button
                  disabled={isExecuting || hasExecuted || !preview || isBlocked}
                  onClick={() => {
                    if (!preview) return;
                    setApplied(true);
                    onExecute(preview.preview_id);
                  }}
                >
                  {t("common:apply")}
                </Button>
              )}
            </>
          )}
        </DialogActions>
        <LinearProgress variant="determinate" color="primary" value={percent} aria-label={t("files:rename.progress")} sx={{ height: 4, flexShrink: 0, bgcolor: "transparent" }} />
      </Dialog>
    </>
  );
}
