import { useId, useState } from "react";
import ArrowDropDownRoundedIcon from "@mui/icons-material/ArrowDropDownRounded";
import { Button, Checkbox, ListItemText, Menu, MenuItem } from "@mui/material";

interface CheckboxFilterMenuProps<T extends string> {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  selected: readonly T[];
  onChange: (selected: T[]) => void;
}

export function CheckboxFilterMenu<T extends string>({
  label, options, selected, onChange,
}: CheckboxFilterMenuProps<T>) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button
        id={`${id}-button`}
        size="small"
        variant="outlined"
        endIcon={<ArrowDropDownRoundedIcon />}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? `${id}-menu` : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{
          minHeight: 30,
          px: 1.25,
          py: 0.5,
          fontSize: 13,
          whiteSpace: "nowrap",
          "& .MuiButton-endIcon": { ml: 0.5 },
          "& .MuiButton-endIcon > svg": { fontSize: 18 },
        }}
      >
        筛选{selected.length !== options.length ? ` (${selected.length}/${options.length})` : ""}
      </Button>
      <Menu
        id={`${id}-menu`}
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: { sx: { minWidth: 136 } },
          list: { "aria-labelledby": `${id}-button`, dense: true },
        }}
      >
        {options.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <MenuItem
              key={option.value}
              dense
              role="menuitemcheckbox"
              aria-checked={checked}
              onClick={() => onChange(checked
                ? selected.filter((value) => value !== option.value)
                : [...selected, option.value])}
            >
              <Checkbox
                size="small"
                checked={checked}
                tabIndex={-1}
                disableRipple
                sx={{
                  p: 0.5,
                  pointerEvents: "none",
                  "& .MuiSvgIcon-root": { fontSize: 18 },
                }}
                slotProps={{ input: { "aria-hidden": true } }}
              />
              <ListItemText primary={option.label} disableTypography sx={{ my: 0 }} />
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
