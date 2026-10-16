import { expect, it } from "vitest";
import type { FileItem } from "../../types";
import { defaultFileSort, sortFileItems } from "./fileSort";

const file = (name: string, modified_at: string | null = null, is_directory = false): FileItem => ({
  id: name, name, path: name, parent_path: "", is_directory, size: null, modified_at,
});

it.each(["asc", "desc"] as const)("sorts complete names naturally in %s order without mutating input", (direction) => {
  const items = [file("文件10.jpg"), file("文件2.jpg"), file("目录10", null, true), file("目录2", null, true)];
  const original = [...items];
  const result = sortFileItems(items, { field: "name", direction });
  expect(result.map((item) => item.name)).toEqual(direction === "asc"
    ? ["目录2", "目录10", "文件2.jpg", "文件10.jpg"]
    : ["目录10", "目录2", "文件10.jpg", "文件2.jpg"]);
  expect(items).toEqual(original);
});

it("breaks equivalent natural names deterministically using the original name and opaque ID", () => {
  const items = [file("2.jpg"), file("02.jpg"), file("a.jpg"), file("A.jpg"),
    { ...file("A.jpg"), id: "other-id" }];
  expect(sortFileItems(items, defaultFileSort).map((item) => item.id))
    .toEqual(["02.jpg", "2.jpg", "A.jpg", "other-id", "a.jpg"]);
  expect(sortFileItems([...items].reverse(), defaultFileSort)).toEqual(sortFileItems(items, defaultFileSort));
});

it.each(["asc", "desc"] as const)("sorts timestamps in %s order, with name ties and missing times last per group", (direction) => {
  const older = "2026-10-16T00:00:20Z";
  const newer = "2026-10-16T08:00:30+08:00";
  const items = [file("missing.jpg"), file("10.jpg", newer), file("2.jpg", newer), file("old.jpg", older),
    file("folder-missing", null, true), file("folder-timed", newer, true)];
  expect(sortFileItems(items, { field: "modified_at", direction }).map((item) => item.name))
    .toEqual(["folder-timed", "folder-missing", ...(direction === "asc"
      ? ["old.jpg", "2.jpg", "10.jpg"] : ["2.jpg", "10.jpg", "old.jpg"]), "missing.jpg"]);
});
