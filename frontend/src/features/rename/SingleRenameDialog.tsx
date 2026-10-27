import { useId, useState, type FocusEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Stack, TextField,
} from "@mui/material";

interface SingleRenameDialogProps {
  initialName: string;
  extension: string;
  isDirectory: boolean;
  isRenaming: boolean;
  canApply: boolean;
  error?: string;
  onApply: (name: string, extension: string) => void;
  onClose: () => void;
}

export function SingleRenameDialog({ initialName, extension, isDirectory, isRenaming, canApply, error,
  onApply, onClose }: SingleRenameDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [name, setName] = useState(initialName);
  const [suffix, setSuffix] = useState(extension.slice(1));
  const applyDisabled = isRenaming || !canApply || !name.trim() ||
    (name === initialName && (isDirectory || suffix === extension.slice(1)));

  return <Dialog open fullWidth maxWidth="sm" aria-labelledby={titleId}
    onClose={() => { if (!isRenaming) onClose(); }}>
    <Box component="form" onSubmit={(event) => {
      event.preventDefault();
      if (!applyDisabled) onApply(name, !isDirectory && suffix ? `.${suffix}` : "");
    }}>
      <DialogTitle id={titleId}>{t("files:quickRename.title")}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction="row" spacing={2} sx={{ "& .MuiInputBase-root, & .MuiInputLabel-root": { typography: "body2" } }}>
            <TextField autoFocus fullWidth size="small" variant="standard" label={t("files:quickRename.name")}
              value={name} disabled={isRenaming} error={Boolean(error)} helperText={error}
              onChange={(event) => setName(event.target.value)}
              sx={{ minWidth: 0, "& .MuiFormHelperText-root": { overflowWrap: "anywhere" } }}
              slotProps={{ htmlInput: { onFocus: (event: FocusEvent<HTMLInputElement>) => event.currentTarget.select() } }} />
            {!isDirectory && <TextField size="small" variant="standard" label={t("files:quickRename.extension")}
              value={suffix} disabled={isRenaming} error={Boolean(error)} onChange={(event) => setSuffix(event.target.value)}
              sx={{ width: 112, flexShrink: 0 }} />}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button type="button" disabled={isRenaming} onClick={onClose}>{t("common:cancel")}</Button>
        <Button type="submit" variant="contained" disabled={applyDisabled} aria-label={t("common:apply")}
          aria-busy={isRenaming} sx={{ minWidth: 80, minHeight: 36 }}>
          {isRenaming ? <CircularProgress size={18} color="inherit" aria-label={t("files:quickRename.applying")} /> : t("common:apply")}
        </Button>
      </DialogActions>
    </Box>
  </Dialog>;
}
