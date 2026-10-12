import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import { Box, Button, Card, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { StorageSettingsPanel } from "./StorageSettingsPanel";
import type { ThemePreference } from "./useThemePreference";

interface SettingsPageProps {
  preference: ThemePreference;
  onPreferenceChange: (preference: ThemePreference) => void;
  onBack: () => void;
  executingStorageId?: string;
}

export function SettingsPage({ preference, onPreferenceChange, onBack, executingStorageId }: SettingsPageProps) {
  return (
    <Box component="section" aria-label="设置" sx={{ width: "100%", maxWidth: 900, mx: "auto", py: 1 }}>
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack}
        sx={{ mb: 2, px: 0, color: "text.secondary", "& .MuiButton-startIcon": { ml: 0 } }}>返回工作台</Button>
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
                slotProps={{ select: { "aria-labelledby": "theme-appearance-title", sx: { typography: "body2" } } }}
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
          <StorageSettingsPanel executingStorageId={executingStorageId} />
        </Box>
      </Stack>
    </Box>
  );
}
