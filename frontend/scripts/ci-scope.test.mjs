import { describe, expect, it, vi } from "vitest";
import { classifyChanges, detectScope } from "./ci-scope.mjs";

const locale = "frontend/src/locales/zh-CN/common.json";
const english = "frontend/src/locales/en-US/common.json";
const change = (path, status = "M") => ({ path, status });

describe("PR frontend checks", () => {
  it.each([
    ["documentation", [change("docs/FRONTEND_TESTING.md")], "skip"],
    ["backend service", [change("backend/app/services/execute_service.py")], "skip"],
    ["empty diff", [], "skip"],
    ["translation text", [change(locale)], "translations"],
    ["new language", [change("frontend/src/locales/fr-FR/common.json", "A")], "translations"],
    ["language metadata", [change("frontend/src/locales/en-US/meta.json")], "translations"],
    ["deleted language", [change(locale, "D")], "full"],
    ["moved resource", [change(locale, "D"), change("docs/common.json", "A")], "full"],
    ["translation and docs", [change(locale), change("README.md")], "full"],
    ["component", [change("frontend/src/WorkspaceApp.tsx")], "full"],
    ["lockfile", [change("frontend/package-lock.json")], "full"],
    ["CI classifier", [change("frontend/scripts/ci-scope.mjs")], "full"],
    ["workflow", [change(".github/workflows/frontend-ci.yml")], "full"],
    ["rule metadata", [change("backend/app/rules/registry.py")], "full"],
    ["provider metadata", [change("backend/app/providers/builtin.py")], "full"],
    ["registration entry", [change("backend/app/api/dependencies.py")], "full"],
    ["new default namespace", [change(english, "A")], "full"],
  ])("routes %s to the appropriate checks", (_scenario, changes, expected) => {
    expect(classifyChanges(changes)).toBe(expected);
  });

  it("allows default text changes and property reordering but checks key and leaf changes fully", () => {
    const before = () => JSON.stringify({ title: "Title", nested: { value: "Text" } });
    const reordered = () => JSON.stringify({ nested: { value: "New text" }, title: "New title" });
    expect(classifyChanges([change(english)], before, reordered)).toBe("translations");
    expect(classifyChanges([change(english)], before, () => JSON.stringify({ title: "Title" }))).toBe("full");
    expect(classifyChanges([change(english)], before, () => JSON.stringify({ title: "Title", nested: "Text" }))).toBe("full");
  });

  it("fails visibly when a changed default dictionary is invalid JSON", () => {
    expect(() => classifyChanges([change(english)], () => "{}", () => "{")).toThrow(SyntaxError);
  });

  it("checks manual runs fully without reading a PR base", () => {
    const git = vi.fn();
    expect(detectScope("workflow_dispatch", undefined, git)).toBe("full");
    expect(git).not.toHaveBeenCalled();
  });

  it("compares the whole PR from its merge base and handles NUL-delimited file names", () => {
    const git = vi.fn().mockReturnValueOnce("merge-base\n")
      .mockReturnValueOnce(`M\0${locale}\0M\0docs/review notes.md\0`);
    expect(detectScope("pull_request", "base-sha", git)).toBe("full");
    expect(git.mock.calls).toEqual([
      ["merge-base", "base-sha", "HEAD"],
      ["diff", "--no-renames", "--name-status", "-z", "merge-base", "HEAD"],
    ]);
  });

  it("propagates Git failures instead of reporting an unrelated PR", () => {
    expect(() => detectScope("pull_request", "missing-base", () => { throw new Error("missing commit"); }))
      .toThrow("missing commit");
  });
});
