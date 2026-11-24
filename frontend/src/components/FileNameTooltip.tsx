import { useState, type ReactElement, type RefObject } from "react";
import Tooltip from "@mui/material/Tooltip";

export function isFileNameTruncated(element: HTMLSpanElement | null) {
  return element !== null && element.scrollWidth > element.clientWidth;
}

export function FileNameTooltip({ children, name, nameRef }: {
  children: ReactElement;
  name: string;
  nameRef: RefObject<HTMLSpanElement>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip describeChild placement="top-start" title={<span>{name}</span>} open={open}
      onOpen={() => setOpen(isFileNameTruncated(nameRef.current))} onClose={() => setOpen(false)}
      slotProps={{ tooltip: { sx: { overflowWrap: "anywhere", whiteSpace: "pre-wrap" } } }}>
      {children}
    </Tooltip>
  );
}
