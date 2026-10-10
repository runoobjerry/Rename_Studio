import AutoFixHighRoundedIcon from "@mui/icons-material/AutoFixHighRounded";
import CloudQueueRoundedIcon from "@mui/icons-material/CloudQueueRounded";
import ComputerRoundedIcon from "@mui/icons-material/ComputerRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Skeleton, Stack, Typography } from "@mui/material";
import type { StorageInfo } from "../../types";

interface StorageSidebarProps {
  storages: StorageInfo[];
  isLoading: boolean;
  disabled: boolean;
  view: "workspace" | "settings";
  storageId: string;
  onSelectStorage: (storageId: string) => void;
  onOpenSettings: () => void;
}

// Drawer 的响应式容器与开关由父组件负责。
export function StorageSidebar({ storages, isLoading, disabled, view, storageId, onSelectStorage, onOpenSettings }: StorageSidebarProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        p: 1.5,
        "& .MuiListItemButton-root": { borderRadius: "14px" },
      }}
    >
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ alignItems: "center", px: 1, py: 1.25, mb: 1 }}
      >
        <Box className="brand-mark"><AutoFixHighRoundedIcon fontSize="small" /></Box>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
            Rename Studio
          </Typography>
          <Typography variant="caption" color="textPrimary">批量重命名工作台</Typography>
        </Box>
      </Stack>
      <Typography
        variant="overline"
        color="textSecondary"
        sx={{ px: 1.5, mt: 1}}
      >
      存储位置
      </Typography>
      <List disablePadding>
        {isLoading && <Skeleton variant="rounded" height={80} aria-label="正在加载存储位置" />}
        {storages.map((provider) => (
          <ListItemButton
            disabled={disabled}
            key={provider.storage_id}
            selected={view === "workspace" && provider.storage_id === storageId}
            onClick={() => onSelectStorage(provider.storage_id)}
          >
            <ListItemIcon>
              {provider.provider_type === "onedrive" ? <CloudQueueRoundedIcon /> : <ComputerRoundedIcon />}
            </ListItemIcon>
            <ListItemText primary={provider.name} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ flex: 1 }} />
      <List disablePadding>
        <ListItemButton
          selected={view === "settings"}
          onClick={onOpenSettings}
        >
          <ListItemIcon><SettingsRoundedIcon /></ListItemIcon>
          <ListItemText primary="设置" />
        </ListItemButton>
      </List>
      <Box className="sidebar-meta">
        <Typography variant="caption" color="textSecondary">© 2026 JERRY </Typography>
        <Typography variant="caption" color="textSecondary">Ver. 0.20-alpha</Typography>
      </Box>
    </Box>
  );
}
