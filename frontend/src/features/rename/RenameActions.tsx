import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PreviewRoundedIcon from "@mui/icons-material/PreviewRounded";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  LinearProgress,
} from "@mui/material";

import type { PreviewResponse, RenameProgress } from "../../types";
import { errorMessage } from "../../i18n/messages";

const phaseLabels = {
  waiting: "files:rename.phases.waiting",
  validating: "files:rename.phases.validating",
  renaming: "files:rename.phases.renaming",
  failed: "files:rename.phases.failed",
  submitting: "files:rename.phases.submitting",
} as const;

export interface RenameActionsProps {
  preview?: PreviewResponse;
  connectionName: string;
  selectedCount: number;
  isPreviewing: boolean;
  isExecuting: boolean;
  isBlocked?: boolean;
  hasExecuted: boolean;
  progress?: RenameProgress;
  progressError?: string;
  executeError?: string;
  revalidationError?: string;
  onPreview: () => void;
  onExecute: (previewId: string) => void;
}

export function RenameActions({
  preview,
  connectionName,
  selectedCount,
  isPreviewing,
  isExecuting,
  isBlocked = false,
  hasExecuted,
  progress,
  progressError,
  executeError,
  revalidationError,
  onPreview,
  onExecute,
}: RenameActionsProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [applied, setApplied] = useState(false);
  const changedCount = preview?.items.filter((item) => item.changed).length ?? 0;
  const currentProgress = progress?.preview_id === preview?.preview_id ? progress : undefined;
  const total = currentProgress?.total ?? changedCount;
  const processed = currentProgress?.processed ?? 0;
  const percent = total > 0 ? Math.min(100, Math.floor(processed / total * 100)) : 0;
  const started = applied || isExecuting || hasExecuted || Boolean(executeError || revalidationError);
  const executionError = revalidationError ?? executeError ?? (currentProgress?.error ? errorMessage({ message: currentProgress.error }, t) : undefined);
  const executionEnded = hasExecuted || Boolean(executeError && !revalidationError && !isExecuting);
  // 进度轮询结束不代表最终响应已返回，继续等待执行请求。
  const phase = executionError ? "failed" : currentProgress?.phase === "finished" ? "renaming"
    : currentProgress?.phase ?? (applied || isExecuting ? "submitting" : "waiting");
  const isFailed = phase === "failed";

  useEffect(() => {
    setConfirming(false);
    setApplied(false);
  }, [preview?.preview_id]);
  useEffect(() => {
    if (executionEnded) setConfirming(false);
  }, [executionEnded]);

  return (
    <>
      <Stack direction="row" spacing={1.25} className="rename-action-bar">
        <Button
          fullWidth
          variant="outlined"
          startIcon={isPreviewing ? <CircularProgress size={16} color="inherit" /> : <PreviewRoundedIcon />}
          disabled={selectedCount === 0 || isPreviewing || isExecuting || isBlocked}
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

      <Dialog open={confirming && !executionEnded} onClose={() => {
        if (!isExecuting && !revalidationError) setConfirming(false);
      }}>
        <DialogTitle>{t(phaseLabels[phase])}</DialogTitle>
        <DialogContent>
          <div style={{ position: "relative" }}>
            {/* 保留确认文案占位，状态切换时弹窗尺寸保持不变。 */}
            <DialogContentText sx={{ visibility: started ? "hidden" : "visible" }}>
              {t("files:rename.confirm", { connectionName, count: changedCount })}
            </DialogContentText>
            {started && !hasExecuted && (
              <DialogContentText role="status" sx={{ position: "absolute", inset: 0, overflowY: "auto",
                color: executionError || (isExecuting && progressError) ? "error.main" : "text.secondary" }}>
                {revalidationError ?? (executionError ? t("files:rename.returnedError", { message: executionError }) : isExecuting && progressError
                  ? t("files:rename.progressUnavailable", { message: progressError })
                  : t("files:rename.processed", { processed, total }))}
              </DialogContentText>
            )}
          </div>
        </DialogContent>
        <DialogActions>
          {revalidationError ? (
            <Button disabled={selectedCount === 0 || isPreviewing || isExecuting || isBlocked}
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
