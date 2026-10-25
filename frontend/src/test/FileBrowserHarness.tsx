import { useMemo, useState, type ComponentProps } from "react";
import { FileBrowser } from "../features/files/FileBrowser";
import { defaultFileSort, sortFileItems, type FileSort } from "../features/files/fileSort";

type Props = Omit<ComponentProps<typeof FileBrowser>, "items" | "sort" | "onSortChange">;

export function FileBrowserHarness(props: Props) {
  const [sort, setSort] = useState<FileSort>(defaultFileSort);
  const items = useMemo(() => sortFileItems(props.listing.items, sort), [props.listing.items, sort]);
  return <FileBrowser {...props} items={items} sort={sort} onSortChange={setSort} />;
}
