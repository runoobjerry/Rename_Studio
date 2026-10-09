import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";

export function VirtualTableSpacer({ height, columns }: { height: number; columns: number }) {
  if (height === 0) return null;
  return <TableRow aria-hidden="true" role="presentation">
    <TableCell colSpan={columns} style={{ height, padding: 0, border: 0 }} />
  </TableRow>;
}
