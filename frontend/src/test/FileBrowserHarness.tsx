import { useMemo, useState, type ComponentProps } from "react";
import { FileBrowser } from "../features/files/FileBrowser";
import { defaultFileSort, fileBrowserItems, type FileSort } from "../features/files/fileSort";
import type { RenameTask } from "../types";

type Props = Omit<ComponentProps<typeof FileBrowser>, "items" | "sort" | "sortLocked" | "onSortChange" | "task"> & {
  task?: RenameTask | null;
};

// 为展示组件提供受控排序；任务状态仍由各测试显式传入。
export function FileBrowserHarness(props: Props) {
  const [sort, setSort] = useState<FileSort>(defaultFileSort);
  const sortLocked = Boolean(props.task?.batches.some((batch) => batch.outcome !== undefined));
  const items = useMemo(() => fileBrowserItems(props.listing.items, props.task, sort, sortLocked),
    [props.listing.items, props.task, sort, sortLocked]);
  return <FileBrowser {...props} items={items} sort={sort} sortLocked={sortLocked} onSortChange={setSort} />;
}
