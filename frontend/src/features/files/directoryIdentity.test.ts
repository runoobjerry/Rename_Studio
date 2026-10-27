import { describe, expect, it } from "vitest";
import { fileItem, listing } from "../../test/fixtures";
import type { StorageLocation } from "../../types";
import { isInDirectory } from "./directoryIdentity";

describe("directory membership", () => {
  it.each([
    { location: { kind: "id", value: "folder-a" }, parent: { kind: "id", value: "folder-a" }, expected: true },
    { location: { kind: "id", value: "folder-a" }, parent: { kind: "id", value: "folder-b" }, expected: false },
    { location: { kind: "path", value: "资料" }, parent: { kind: "path", value: "资料" }, expected: true },
    { location: { kind: "path", value: "资料" }, parent: { kind: "path", value: "其他" }, expected: false },
    { location: { kind: "path", value: "资料" }, parent: { kind: "root" }, expected: false },
    { location: { kind: "root" }, parent: { kind: "path", value: "其他" }, expected: false },
    { location: { kind: "root" }, parent: { kind: "id", value: "real-root" }, expected: null },
    { location: { kind: "id", value: "folder-a" }, parent: null, expected: null },
  ] satisfies Array<{ location: StorageLocation; parent: StorageLocation | null; expected: boolean | null }>)(
    "compares $location with $parent using identity", ({ location, parent, expected }) => {
      expect(isInDirectory({ ...listing(), location }, fileItem("file", { parent_location: parent }))).toBe(expected);
    });
});
