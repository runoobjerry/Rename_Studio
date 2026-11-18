import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import FilterList from "@mui/icons-material/FilterList";
import FilterListOff from "@mui/icons-material/FilterListOff";
import { FormControl, FormControlLabel, FormLabel, Popover, Radio, RadioGroup, Tooltip } from "@mui/material";
import { PanelIconButton } from "./PanelIconButton";

interface RadioFilterMenuProps<T extends string> {
  label: string;
  disabled?: boolean;
  options: ReadonlyArray<{ value: T; label: string }>;
  selected: T;
  onChange: (selected: T) => void;
}

export function RadioFilterMenu<T extends string>({
  label, options, selected, onChange, disabled = false,
}: RadioFilterMenuProps<T>) {
  const { t } = useTranslation();
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const active = selected !== "all";
  return (
    <>
      <Tooltip title={t("common:filterState", { label, state: t(active ? "common:enabled" : "common:disabled") })} arrow>
        <PanelIconButton
          id={`${id}-button`}
          size="small"
          disabled={disabled}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={Boolean(anchor)}
          aria-controls={anchor ? `${id}-menu` : undefined}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={active ? { color: "primary.main" } : undefined}
        >
          {active ? <FilterList sx={{ fontSize: 20 }} /> : <FilterListOff sx={{ fontSize: 20 }} />}
        </PanelIconButton>
      </Tooltip>
      <Popover
        id={`${id}-menu`}
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: { role: "dialog", "aria-labelledby": `${id}-button`,
            sx: { display: "flex", flexDirection: "column", p: 1.5, pb: "6px", mt: 0.5, borderRadius: "10px",
              border: 1, borderColor: "divider", backgroundImage: "none" } },
        }}
      >
        <FormControl disabled={disabled}>
          <FormLabel id={`${id}-label`} sx={{ fontSize: 12, fontWeight: 700 }}>{label}</FormLabel>
          <RadioGroup aria-labelledby={`${id}-label`} name={`${id}-status`} value={selected}
            sx={{ mr: "-16px" }}
            onChange={(event) => onChange(event.target.value as T)}>
            {options.map((option) => <FormControlLabel key={option.value} value={option.value}
              control={<Radio size="small" sx={{ py: "6px" }} />} label={option.label}
              sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }} />)}
          </RadioGroup>
        </FormControl>
      </Popover>
    </>
  );
}
