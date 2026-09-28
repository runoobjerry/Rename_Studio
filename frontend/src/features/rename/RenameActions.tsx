import { useEffect, useState } from "react";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PreviewRoundedIcon from "@mui/icons-material/PreviewRounded";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
} from "@mui/material";

import type { PreviewResponse } from "../../types";

interface RenameActionsProps {
  preview?: PreviewResponse;
  providerName: string;
  selectedCount: number;
  isPreviewing: boolean;
  isExecuting: boolean;
  hasExecuted: boolean;
  onPreview: () => void;
  onExecute: (previewId: string) => void;
}

export function RenameActions({
  preview,
  providerName,
  selectedCount,
  isPreviewing,
  isExecuting,
  hasExecuted,
  onPreview,
  onExecute,
}: RenameActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const changedCount = preview?.items.filter((item) => item.changed).length ?? 0;

  useEffect(() => setConfirming(false), [preview?.preview_id]);
  useEffect(() => {
    if (hasExecuted) setConfirming(false);
  }, [hasExecuted]);

  return (
    <>
      <Stack direction="row" spacing={1.25} className="rename-action-bar">
        <Button
          fullWidth
          variant="outlined"
          startIcon={<PreviewRoundedIcon />}
          disabled={selectedCount === 0 || isPreviewing || isExecuting}
          onClick={onPreview}
        >
          {isPreviewing ? "正在预览…" : "预览"}
        </Button>
        <Button
          fullWidth
          variant="contained"
          startIcon={<PlayArrowRoundedIcon />}
          disabled={!preview?.valid || changedCount === 0 || isExecuting || hasExecuted}
          onClick={() => setConfirming(true)}
        >
          {isExecuting ? "正在修改…" : "开始修改"}
        </Button>
      </Stack>

      <Dialog open={confirming} onClose={() => !isExecuting && setConfirming(false)}>
        <DialogTitle>确认开始修改？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            将根据当前预览修改 {providerName} 中的 {changedCount} 个项目。此操作不能绕过预览。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={isExecuting} onClick={() => setConfirming(false)}>取消</Button>
          <Button
            variant="contained"
            disabled={isExecuting || !preview}
            onClick={() => preview && onExecute(preview.preview_id)}
          >
            {isExecuting ? "正在修改…" : "确认修改"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
