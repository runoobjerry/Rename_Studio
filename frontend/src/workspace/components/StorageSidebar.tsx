import { useTranslation } from "react-i18next";
import brandMark from "../../assets/brand-mark.svg";
import CloudQueueRoundedIcon from "@mui/icons-material/CloudQueueRounded";
import ComputerRoundedIcon from "@mui/icons-material/ComputerRounded";
import StorageRoundedIcon from "@mui/icons-material/StorageRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import { Box, Divider, List, ListItemButton, ListItemIcon, ListItemText, Skeleton, Stack, Tooltip, Typography } from "@mui/material";
import { useLayoutEffect, useRef, useState } from "react";
import type { StorageInfo, StorageProviderDefinition } from "../../types";

interface StorageSidebarProps {
  storages: StorageInfo[];
  providerDefinitions: StorageProviderDefinition[];
  isLoading: boolean;
  disabled: boolean;
  view: "workspace" | "settings";
  storageId: string;
  onSelectStorage: (storageId: string) => void;
  onOpenSettings: () => void;
}

const providerIcons = { computer: ComputerRoundedIcon, cloud: CloudQueueRoundedIcon };

function StorageName({ name }: { name: string }) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = nameRef.current!;
    const updateOverflow = () => setIsOverflowing(element.scrollWidth > element.clientWidth);
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  }, [name]);

  return (
    <Tooltip title={isOverflowing ? name : ""}>
      <ListItemText
        sx={{ minWidth: 0 }}
        primary={<Typography ref={nameRef} component="span" noWrap sx={{ display: "block" }}>{name}</Typography>}
      />
    </Tooltip>
  );
}

// Drawer 的响应式容器与开关由父组件负责。
export function StorageSidebar({ storages, providerDefinitions, isLoading, disabled, view, storageId, onSelectStorage, onOpenSettings }: StorageSidebarProps) {
  const { t } = useTranslation();
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
        <Box component="img" src={brandMark} alt="" width={36} height={36} sx={{ display: "block", flexShrink: 0 }} />
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.1 }}>
            Rename Studio
          </Typography>
        </Box>
      </Stack>
      <Typography
        variant="overline"
        color="textSecondary"
        sx={{ px: 1.5, mt: 1}}
      >
      {t("files:sidebar.title")}
      </Typography>
      <List disablePadding>
        {isLoading && <Skeleton variant="rounded" height={80} aria-label={t("files:sidebar.loading")} />}
        {storages.map((storage) => {
          const definition = providerDefinitions.find((entry) => entry.provider_type === storage.provider_type);
          const Icon = definition ? providerIcons[definition.icon] : StorageRoundedIcon;
          return (
            <ListItemButton
              disabled={disabled}
              key={storage.storage_id}
              selected={view === "workspace" && storage.storage_id === storageId}
              onClick={() => onSelectStorage(storage.storage_id)}
            >
              <ListItemIcon>
                <Icon />
              </ListItemIcon>
              <StorageName name={storage.name} />
            </ListItemButton>
          );
        })}
      </List>
      <Box sx={{ flex: 1 }} />
      <Divider sx={{ my: 0.5, borderColor: "var(--app-border)" }} />
      <List disablePadding>
        <ListItemButton
          selected={view === "settings"}
          onClick={onOpenSettings}
        >
          <ListItemIcon><SettingsRoundedIcon /></ListItemIcon>
          <ListItemText primary={t("settings:title")} />
        </ListItemButton>
      </List>
    </Box>
  );
}
