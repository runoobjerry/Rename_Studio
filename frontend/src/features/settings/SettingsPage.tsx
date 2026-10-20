import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLanguagePreference } from "../../i18n/LanguageProvider";
import { languages } from "../../i18n/languages";
import { formatDate } from "../../i18n/format";
import { useNotification } from "../../components/NotificationProvider";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import brandMark from "../../assets/brand-mark.svg";
import GitHubIcon from "@mui/icons-material/GitHub";
import { version } from "../../../package.json";
import { Box, Button, Card, Divider, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
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
  const { t } = useTranslation("settings");
  const language = useLanguagePreference();
  const selectedLanguage = languages.find(({ code }) => code.toLowerCase() === language.preference.toLowerCase())?.code ?? language.preference;
  const notify = useNotification();
  const buildTime = formatDate(new Date(import.meta.env.VITE_BUILD_TIME), {
    timeZone: "Asia/Shanghai", hour12: false,
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  });
  const changeLanguage = (next: string) => {
    void language.setPreference(next).catch((error: Error) => {
      notify({ key: "settings:languageSaveFailed", values: { message: error.message } }, "error");
    });
  };
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmReset = () => {
    void onFactoryReset().then((success) => { if (success) setConfirmOpen(false); });
  };
  return (
    <Box component="section" aria-label={t("title")} sx={{ width: "100%", maxWidth: 900, mx: "auto", py: 1 }}>
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack}
        sx={{ mb: 2, color: "text.secondary", "& .MuiButton-startIcon": { ml: 0 } }}>{t("back")}</Button>
      <Stack spacing={3}>
        <Box component="section" aria-labelledby="general-settings-title">
          <Typography id="general-settings-title" component="h2" variant="subtitle1" sx={{ mb: 1.25, fontWeight: 600 }}>{t("general")}</Typography>
          <Card variant="outlined">
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, p: { xs: 2, sm: 2.5 } }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography id="theme-appearance-title" variant="body2" sx={{ fontWeight: 500 }}>{t("theme")}</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", mt: 0.5 }}>{t("themeHelp")}</Typography>
              </Box>
              <TextField select size="small" value={preference}
                onChange={(event) => onPreferenceChange(event.target.value as ThemePreference)}
                slotProps={{ select: { labelId: "theme-appearance-title", sx: { typography: "body2" } } }}
                sx={{ width: { xs: 132, sm: 160 }, flexShrink: 0 }}>
                <MenuItem value="light" sx={{ typography: "body2" }}>{t("light")}</MenuItem>
                <MenuItem value="dark" sx={{ typography: "body2" }}>{t("dark")}</MenuItem>
                <MenuItem value="system" sx={{ typography: "body2" }}>{t("system")}</MenuItem>
              </TextField>
            </Stack>
            <Divider />
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, p: { xs: 2, sm: 2.5 } }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography id="interface-language-title" variant="body2" sx={{ fontWeight: 500 }}>{t("language")}</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", mt: 0.5 }}>{t("languageHelp")}</Typography>
              </Box>
              <TextField select size="small" value={selectedLanguage} disabled={resetPending}
                onChange={(event) => changeLanguage(event.target.value)}
                slotProps={{ select: { labelId: "interface-language-title", sx: { typography: "body2" } } }}
                sx={{ width: { xs: 156, sm: 180 }, flexShrink: 0 }}>
                <MenuItem value="auto" sx={{ typography: "body2" }}>{t("auto")}</MenuItem>
                {languages.map(({ code, name }) => <MenuItem key={code} value={code} sx={{ typography: "body2" }}>{name}</MenuItem>)}
                {selectedLanguage !== "auto" && !languages.some(({ code }) => code === selectedLanguage) && (
                  <MenuItem value={language.preference} disabled>{t("unavailableLanguage", { code: language.preference })}</MenuItem>
                )}
              </TextField>
            </Stack>
          </Card>
        </Box>
        <Box component="section" aria-labelledby="connection-settings-title">
          <Typography id="connection-settings-title" component="h2" variant="subtitle1" sx={{ mb: 1.25, fontWeight: 600 }}>{t("connections")}</Typography>
          <StorageSettingsPanel key={resetEpoch} executingStorageId={executingStorageId} />
        </Box>
        <Box component="section" aria-labelledby="reset-settings-title">
          <Typography id="reset-settings-title" component="h2" variant="subtitle1" sx={{ mb: 1.25, fontWeight: 600 }}>{t("reset")}</Typography>
          <Card variant="outlined">
            <Button fullWidth color="inherit" disabled={Boolean(resetDisabledReason) || resetPending}
              onClick={() => setConfirmOpen(true)} endIcon={<KeyboardArrowRightIcon />}
              sx={{ typography: "body2", fontWeight: 500, justifyContent: "space-between", textAlign: "left", px: { xs: 2, sm: 2.5 }, py: 2 }}>
              {t("resetAction")}
            </Button>
          </Card>
          {resetDisabledReason && <Typography variant="caption" sx={{ color: "text.secondary", mt: 0.75, display: "block" }}>{resetDisabledReason}</Typography>}
        </Box>
        <Box component="section" aria-labelledby="about-settings-title">
          <Typography id="about-settings-title" component="h2" variant="subtitle1" sx={{ mb: 1.25, fontWeight: 600 }}>{t("about")}</Typography>
          <Card variant="outlined">
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, p: { xs: 2, sm: 2.5 } }}>
              <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 0 }}>
                <Box component="img" src={brandMark} alt="" width={36} height={36} sx={{ display: "block", flexShrink: 0 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Rename Studio</Typography>
              </Stack>
              <Box sx={{ flexShrink: 0, textAlign: "right" }}>
                <Typography variant="body2" color="text.secondary">v{version}</Typography>
                <Typography variant="caption" component="div" sx={{ color: "text.secondary"}}>{buildTime} BUILD</Typography>
              </Box>
            </Stack>
            <Divider />
            <Button fullWidth color="inherit" href="https://github.com/runoobjerry/Rename_Studio"
              target="_blank" rel="noopener noreferrer" aria-label={t("sourceAria")}
              endIcon={<GitHubIcon />}
              sx={{ borderRadius: 0, typography: "body2", fontWeight: 500, justifyContent: "space-between", textAlign: "left", px: { xs: 2, sm: 2.5 }, py: 2 }}>
              {t("source")}
            </Button>
            <Divider />
            <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
              <Typography variant="body2">{t("copyright")}</Typography>
              <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 0.5 }}>
                {t("license")}
              </Typography>
            </Box>
          </Card>
        </Box>
      </Stack>
      <Dialog open={confirmOpen} onClose={() => { if (!resetPending) setConfirmOpen(false); }} aria-labelledby="factory-reset-title">
        <DialogTitle id="factory-reset-title">{t("confirmReset")}</DialogTitle>
        <DialogContent><DialogContentText variant="body2" sx={{ whiteSpace: 'pre-line' }} >
          {t("resetDescription")}
        </DialogContentText></DialogContent>
        <DialogActions sx={{ "& .MuiButton-root": { fontSize: "body2.fontSize" } }}>
          <Button disabled={resetPending} onClick={() => setConfirmOpen(false)}>{t("common:cancel")}</Button>
          <Button color="error" disabled={resetPending || Boolean(resetDisabledReason)} onClick={confirmReset}>{t("reset")}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
