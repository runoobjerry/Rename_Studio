import { useId, useState } from "react";
import FilterList from "@mui/icons-material/FilterList";
import FilterListOff from "@mui/icons-material/FilterListOff";
import { Checkbox, IconButton, ListItemText, Menu, MenuItem, Tooltip } from "@mui/material";

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
  const active = selected.length > 0;
  return (
    <>
      <Tooltip title={`${label}（${active ? "已启用" : "未启用"}）`} arrow>
        <IconButton
          id={`${id}-button`}
          size="small"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
          aria-controls={anchor ? `${id}-menu` : undefined}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{
            width: 30,
            height: 30,
            p: 0.75,
            color: active ? "primary.main" : "text.secondary",
            "& .MuiSvgIcon-root": { fontSize: 18 },
          }}
        >
          {active ? <FilterList /> : <FilterListOff />}
        </IconButton>
      </Tooltip>
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
