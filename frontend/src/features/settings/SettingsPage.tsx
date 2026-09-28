import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import { Box, Button, Card, CardContent, Stack, Switch, Typography } from "@mui/material";
import type { PaletteMode } from "@mui/material";

import { OneDriveSettingsPanel } from "./OneDriveSettingsPanel";

interface SettingsPageProps {
  mode: PaletteMode;
  onModeChange: (mode: PaletteMode) => void;
  onBack: () => void;
}

export function SettingsPage({ mode, onModeChange, onBack }: SettingsPageProps) {
  const darkMode = mode === "dark";

  return (
    <Box component="section" aria-labelledby="settings-title">
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack} sx={{ mb: 2 }}>
        返回工作台
      </Button>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography id="settings-title" variant="h4" component="h1">
          设置
        </Typography>
        <Typography color="text.secondary">管理存储连接和应用外观。</Typography>
      </Stack>

      <Box sx={{ display: "grid", gap: 2.5, maxWidth: 900 }}>
        <Card variant="outlined">
          <CardContent>
            <Stack
              direction="row"
              sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                {darkMode ? <DarkModeRoundedIcon color="primary" /> : <LightModeRoundedIcon color="primary" />}
                <Box>
                  <Typography variant="h6">黑暗模式</Typography>
                  <Typography variant="body2" color="text.secondary">
                    在浅色与深色界面之间切换。
                  </Typography>
                </Box>
              </Stack>
              <Switch
                checked={darkMode}
                onChange={(_, checked) => onModeChange(checked ? "dark" : "light")}
                slotProps={{ input: { "aria-label": "切换黑暗模式" } }}
              />
            </Stack>
          </CardContent>
        </Card>

        <OneDriveSettingsPanel />
      </Box>
    </Box>
  );
}
