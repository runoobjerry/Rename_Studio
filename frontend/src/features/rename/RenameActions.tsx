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

export interface RenameActionsProps {
  preview?: PreviewResponse;
  providerName: string;
  selectedCount: number;
  isPreviewing: boolean;
  isExecuting: boolean;
  isBlocked?: boolean;
  hasExecuted: boolean;
  allowUnchangedBatch?: boolean;
  progress?: RenameProgress;
  progressError?: string;
  executeError?: string;
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
  hasExecuted,
  allowUnchangedBatch = false,
  progress,
  progressError,
  executeError,
  onPreview,
  onExecute,
}: RenameActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [applied, setApplied] = useState(false);
  const changedCount = preview?.items.filter((item) => item.changed).length ?? 0;
  const currentProgress = progress?.preview_id === preview?.preview_id ? progress : undefined;
  const total = currentProgress?.total ?? changedCount;
  const processed = hasExecuted ? total : currentProgress?.processed ?? 0;
  const percent = total > 0 ? Math.min(100, Math.floor(processed / total * 100)) : 0;
  const phaseLabels = {
    waiting: "等待确认", validating: "正在复核", staging: "正在准备临时名称",
    renaming: "正在修改", rollback: "正在回滚", finished: "处理结束", failed: "执行失败",
  };
  const started = applied || isExecuting || hasExecuted || Boolean(executeError);
  const executionError = executeError ?? currentProgress?.error;
  const phase = hasExecuted ? "finished" : executionError ? "failed" : currentProgress?.phase ?? "waiting";
  const isFailed = phase === "failed";

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
          disabled={selectedCount === 0 || isPreviewing || isExecuting || isBlocked}
          onClick={onPreview}
        >
          {isPreviewing ? "正在刷新…" : "刷新预览"}
        </Button>
        <Button
          fullWidth
          variant="contained"
          startIcon={<PlayArrowRoundedIcon />}
          disabled={!preview?.valid || (changedCount === 0 && !allowUnchangedBatch) || isExecuting || hasExecuted || isBlocked}
          onClick={() => { setApplied(false); setConfirming(true); }}
        >
          开始修改
        </Button>
      </Stack>

      <Dialog open={confirming} onClose={() => !isExecuting && setConfirming(false)}>
        <DialogTitle>{phaseLabels[phase]}</DialogTitle>
        <DialogContent>
          {started ? (
            <DialogContentText role="status" sx={{ color: executionError || (isExecuting && progressError) ? "error.main" : "text.secondary" }}>
              {executionError ? `返回错误：${executionError}，请尝试刷新文件目录。` : isExecuting && progressError
                ? `暂时无法读取进度：${progressError}；执行请求仍在进行，请勿重复提交。`
                : `当前任务已处理 ${processed} 项，共 ${total} 项。稍等片刻，请勿刷新页面。`}
            </DialogContentText>
          ) : (
            <DialogContentText>
              {changedCount === 0 && allowUnchangedBatch && "本批没有名称变化，确认后将记录为已完成。"}
              将根据当前预览区新文件名修改 {providerName} 中的 {changedCount} 个项目。请注意，
              <Typography component="span" variant="inherit" sx={{ color: "error.main" }}>此操作不可恢复！</Typography>
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={isExecuting} onClick={() => setConfirming(false)}>
            {isFailed ? "关闭" : "取消"}
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
              应用
            </Button>
          )}
        </DialogActions>
        <LinearProgress variant="determinate" color="primary" value={percent} aria-label="修改进度" sx={{ height: 4, flexShrink: 0, bgcolor: "transparent" }} />
      </Dialog>
    </>
  );
}
