import type { FileItem } from "../../types";

export interface FileSort {
  field: "name" | "modified_at";
  direction: "asc" | "desc";
}

export const defaultFileSort: FileSort = { field: "name", direction: "asc" };

const locales = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || "en-US"];
const nameCollator = new Intl.Collator(locales, { numeric: true, sensitivity: "base" });
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

const compareNames = (left: FileItem, right: FileItem) =>
  nameCollator.compare(left.name, right.name) || compareText(left.name, right.name) || compareText(left.id, right.id);

export function sortFileItems(items: readonly FileItem[], sort: FileSort): FileItem[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    if (left.is_directory !== right.is_directory) return left.is_directory ? -1 : 1;
    if (sort.field === "name") return direction * compareNames(left, right);
    // 空时间始终在本组末尾；同一时间按文件名升序，避免刷新后跳动。
    if (left.modified_at === null && right.modified_at !== null) return 1;
    if (left.modified_at !== null && right.modified_at === null) return -1;
    const difference = left.modified_at !== null && right.modified_at !== null
      ? Date.parse(left.modified_at) - Date.parse(right.modified_at) : 0;
    return direction * difference || compareNames(left, right);
  });
}
