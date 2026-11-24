import { useId } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../../i18n/messages";
import { Alert, Box, Button, IconButton } from "@mui/material";
import sidebarIcon from "../../assets/icon/sidebar.svg";
import { PanelActionGroup } from "../../components/PanelHeadingControls";
import { LocationBreadcrumbs } from "../../features/files/LocationBreadcrumbs";
import type { DirectoryListing, StorageLocation } from "../../types";

interface StorageLocationPanelProps {
  compactNavigation: boolean;
  listing?: DirectoryListing;
  rootLabel: string;
  requiresAuth: boolean;
  supportsLocalPicker: boolean;
  navigationDisabled: boolean;
  defaultPathDisabled: boolean;
  browseDisabled: boolean;
  isPickingFolder: boolean;
  pickerError: Error | null;
  onOpenNavigation: () => void;
  onNavigate: (location: StorageLocation) => void;
  onSetDefaultPath: () => void;
  onBrowse: () => void;
}

export function StorageLocationPanel({
  compactNavigation, listing, rootLabel, requiresAuth, supportsLocalPicker, navigationDisabled,
  defaultPathDisabled, browseDisabled, isPickingFolder,
  pickerError, onOpenNavigation,
  onNavigate, onSetDefaultPath, onBrowse,
}: StorageLocationPanelProps) {
  const { t } = useTranslation();
  const locationId = useId();
  return (
    <section id={locationId} aria-label={t("files:location.title")}>
      <div className="location-toolbar">
        <div className="panel location-navigation">
          {compactNavigation && (
            <IconButton onClick={onOpenNavigation} aria-label={t("files:location.openNavigation")} sx={{ p: "4px" }}>
              <Box component="span" aria-hidden="true" sx={{
                width: 20, height: 20, bgcolor: "currentColor",
                mask: `url("${sidebarIcon}") center / contain no-repeat`,
                WebkitMask: `url("${sidebarIcon}") center / contain no-repeat`,
              }} />
            </IconButton>
          )}
          <LocationBreadcrumbs
            listing={listing}
            rootLabel={rootLabel}
            disabled={navigationDisabled}
            onNavigate={onNavigate}
          />
        </div>
        {(requiresAuth || supportsLocalPicker) && (
          <PanelActionGroup labelledBy={locationId}>
            {requiresAuth && (
              <Button onClick={onSetDefaultPath} disabled={defaultPathDisabled}>
                {t("files:location.setDefault")}
              </Button>
            )}
            {supportsLocalPicker && (
              <Button onClick={onBrowse} disabled={browseDisabled}>
                {isPickingFolder ? t("files:location.picking") : t("files:location.browse")}
              </Button>
            )}
          </PanelActionGroup>
        )}
      </div>
      {supportsLocalPicker && pickerError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {t("files:location.pickerFailed", { message: errorMessage(pickerError, t) })}
        </Alert>
      )}
    </section>
  );
}
