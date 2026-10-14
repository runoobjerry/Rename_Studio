import { useState } from "react";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { Box, Button, Card, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { StorageSettingsPanel } from "./StorageSettingsPanel";
import type { ThemePreference } from "./useThemePreference";

interface SettingsPageProps {
  preference: ThemePreference;
  onPreferenceChange: (preference: ThemePreference) => void;
  onBack: () => void;
  executingStorageId?: string;
  onFactoryReset: () => Promise<boolean>;
  resetDisabledReason?: string;
  resetPending: boolean;
  resetEpoch: number;
}

export function SettingsPage({ preference, onPreferenceChange, onBack, executingStorageId,
  onFactoryReset, resetDisabledReason, resetPending, resetEpoch }: SettingsPageProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmReset = () => {
    void onFactoryReset().then((success) => { if (success) setConfirmOpen(false); });
  };
  return (
    <Box component="section" aria-label="设置" sx={{ width: "100%", maxWidth: 900, mx: "auto", py: 1 }}>
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack}
        sx={{ mb: 2, color: "text.secondary", "& .MuiButton-startIcon": { ml: 0 } }}>返回主页</Button>
      <Stack spacing={3}>
        <Box component="section" aria-labelledby="general-settings-title">
          <Typography id="general-settings-title" component="h2" variant="subtitle1" sx={{ mb: 1.25, fontWeight: 600 }}>常规</Typography>
          <Card variant="outlined">
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, p: { xs: 2, sm: 2.5 } }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography id="theme-appearance-title" variant="body2" sx={{ fontWeight: 500 }}>外观主题</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", mt: 0.5 }}>选择您偏好的界面主题</Typography>
              </Box>
              <TextField select size="small" value={preference}
                onChange={(event) => onPreferenceChange(event.target.value as ThemePreference)}
                slotProps={{ select: { labelId: "theme-appearance-title", sx: { typography: "body2" } } }}
                sx={{ width: { xs: 132, sm: 160 }, flexShrink: 0 }}>
                <MenuItem value="light" sx={{ typography: "body2" }}>浅色</MenuItem>
                <MenuItem value="dark" sx={{ typography: "body2" }}>深色</MenuItem>
                <MenuItem value="system" sx={{ typography: "body2" }}>跟随系统</MenuItem>
              </TextField>
            </Stack>
          </Card>
        </Box>
        <Box component="section" aria-labelledby="connection-settings-title">
          <Typography id="connection-settings-title" component="h2" variant="subtitle1" sx={{ mb: 1.25, fontWeight: 600 }}>连接设置</Typography>
          <StorageSettingsPanel key={resetEpoch} executingStorageId={executingStorageId} />
        </Box>
        <Box component="section" aria-labelledby="reset-settings-title">
          <Typography id="reset-settings-title" component="h2" variant="subtitle1" sx={{ mb: 1.25, fontWeight: 600 }}>重置</Typography>
          <Card variant="outlined">
            <Button fullWidth color="inherit" disabled={Boolean(resetDisabledReason) || resetPending}
              onClick={() => setConfirmOpen(true)} endIcon={<KeyboardArrowRightIcon />}
              sx={{ typography: "body2", fontWeight: 500, justifyContent: "space-between", textAlign: "left", px: { xs: 2, sm: 2.5 }, py: 2 }}>
              将应用还原为原始默认状态
            </Button>
          </Card>
          {resetDisabledReason && <Typography variant="caption" sx={{ color: "text.secondary", mt: 0.75, display: "block" }}>{resetDisabledReason}</Typography>}
        </Box>
      </Stack>
      <Dialog open={confirmOpen} onClose={() => { if (!resetPending) setConfirmOpen(false); }} aria-labelledby="factory-reset-title">
        <DialogTitle id="factory-reset-title">确认重置？</DialogTitle>
        <DialogContent><DialogContentText variant="body2" sx={{ whiteSpace: 'pre-line' }} >
          {`此操作将会：\n\n- 删除已保存的连接设置和本地授权凭证\n- 恢复主题、提示及默认云目录偏好\n- 清空当前规则链\n\n不会删除真实文件，也不会撤销已执行的重命名。`}
        </DialogContentText></DialogContent>
        <DialogActions sx={{ "& .MuiButton-root": { fontSize: "body2.fontSize" } }}>
          <Button disabled={resetPending} onClick={() => setConfirmOpen(false)}>取消</Button>
          <Button color="error" disabled={resetPending || Boolean(resetDisabledReason)} onClick={confirmReset}>重置</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
