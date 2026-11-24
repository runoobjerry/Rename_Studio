import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import CloseIcon from "@mui/icons-material/Close";
import FilterList from "@mui/icons-material/FilterList";
import FilterListOff from "@mui/icons-material/FilterListOff";
import SearchIcon from "@mui/icons-material/Search";
import {
  Autocomplete,
  Box,
  Button,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  InputAdornment,
  OutlinedInput,
  Popover,
  Radio,
  RadioGroup,
  TextField,
  Tooltip,
} from "@mui/material";

const fileTypes = [
  { value: "all", labelKey: "files:filters.all" },
  { value: "file", labelKey: "files:types.file" },
  { value: "folder", labelKey: "files:types.folder" },
  { value: "extension", labelKey: "files:columns.extension" },
] as const;

export type FileFilterType = typeof fileTypes[number]["value"];

interface FileFilterMenuProps {
  type: FileFilterType;
  keyword: string;
  extensions: string[];
  disabled?: boolean;
  onTypeChange: (type: FileFilterType) => void;
  onKeywordChange: (keyword: string) => void;
  onExtensionsChange: (extensions: string[]) => void;
}

export function FileFilterMenu({ type, keyword, extensions, disabled = false,
  onTypeChange, onKeywordChange, onExtensionsChange }: FileFilterMenuProps) {
  const { t } = useTranslation();
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [invalidExtension, setInvalidExtension] = useState(false);
  const active = type !== "all" || keyword.trim().length > 0;
  return <>
    <Tooltip title={t("common:filterState", {
      label: t("files:filterItems"), state: t(active ? "common:enabled" : "common:disabled"),
    })} arrow>
      <span>
        <Button
          id={`${id}-button`}
          disabled={disabled}
          aria-label={t("files:filterItems")}
          aria-haspopup="dialog"
          aria-expanded={Boolean(anchor)}
          aria-controls={anchor ? `${id}-panel` : undefined}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={active ? { color: "primary.main" } : undefined}
        >
          {active ? <FilterList /> : <FilterListOff />}
        </Button>
      </span>
    </Tooltip>
    <Popover
      anchorEl={anchor}
      open={Boolean(anchor)}
      onClose={() => setAnchor(null)}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{ paper: {
        id: `${id}-panel`, role: "dialog", "aria-labelledby": `${id}-button`,
        sx: { width: "max-content", maxWidth: "calc(100vw - 32px)", p: 1.5, mt: 0.5,
          display: "grid", gridTemplateColumns: "minmax(0, max-content)", gap: 1,
          border: 1, borderColor: "divider", backgroundImage: "none",
          "& .MuiInputBase-root": { minHeight: 38, fontSize: 13 },
          "& .MuiChip-root": { fontSize: 13 },
        },
      } }}
    >
      <FormControl disabled={disabled}>
        <FormLabel id={`${id}-type`} sx={{ fontSize: 12, fontWeight: 700 }}>
          {t("files:filters.type")}
        </FormLabel>
        <RadioGroup row aria-labelledby={`${id}-type`} name={`${id}-type`} value={type}
          sx={{ mr: "-16px" }}
          onChange={(event) => onTypeChange(event.target.value as FileFilterType)}>
          {fileTypes.map((option) => <FormControlLabel key={option.value} value={option.value}
            control={<Radio size="small" />} label={t(option.labelKey)}
            sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }} />)}
        </RadioGroup>
      </FormControl>
      {type === "extension" && <Box sx={{ width: 0, minWidth: "100%", mt: -0.5 }}>
        <Autocomplete<string, true, false, true>
          multiple
          freeSolo
          forcePopupIcon={false}
          options={[]}
          size="small"
          disabled={disabled}
          value={extensions}
          inputValue={inputValue}
          onInputChange={(_, value, reason) => {
            setInputValue(value);
            if (reason === "input" || reason === "clear") setInvalidExtension(false);
          }}
          onChange={(_, values, reason) => {
            if (reason === "createOption") {
              const input = values[values.length - 1];
              const extension = input.trim().replace(/^\.+/, "").toLowerCase();
              if (!extension || /[\s./\\:*?"<>|\u0000-\u001f\u007f]/u.test(extension)) {
                setInputValue(input);
                setInvalidExtension(true);
                return;
              }
              onExtensionsChange([...new Set([...extensions, extension])]);
              setInputValue("");
            } else {
              onExtensionsChange(values);
            }
            setInvalidExtension(false);
          }}
          clearText={t("files:filters.clearExtensions")}
          renderInput={(params) => <TextField {...params} size="small"
            hiddenLabel
            placeholder={extensions.length === 0 ? t("files:filters.extensionsHelp") : undefined}
            slotProps={{ ...params.slotProps,
              htmlInput: { ...params.slotProps.htmlInput, "aria-label": t("files:columns.extension") },
              formHelperText: { sx: { mx: 0, mt: "6px", fontSize: 12 } },
            }}
            error={invalidExtension}
            helperText={invalidExtension ? t("files:filters.invalidExtension") : undefined}
          />}
        />
      </Box>}
      <Divider sx={{ width: 0, minWidth: "100%" }} />
      <FormControl disabled={disabled} fullWidth size="small" sx={{ width: 0, minWidth: "100%", gap: "6px" }}>
        <FormLabel htmlFor={`${id}-name`} sx={{ fontSize: 12, fontWeight: 700 }}>
          {t("files:filters.name")}
        </FormLabel>
        <OutlinedInput
          id={`${id}-name`}
          autoFocus
          fullWidth
          size="small"
          sx={{ height: 38, pr: keyword.length > 0 ? "39px" : undefined }}
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          startAdornment={<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>}
          endAdornment={keyword.length > 0 ? <InputAdornment position="end"
            sx={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)" }}>
            <IconButton size="small" aria-label={t("files:filters.clearName")}
              sx={{ p: 0.5, mr: "-2px" }} disabled={disabled} onClick={() => onKeywordChange("")}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </InputAdornment> : undefined}
        />
      </FormControl>
    </Popover>
  </>;
}
