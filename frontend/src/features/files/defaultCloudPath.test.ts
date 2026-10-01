import { beforeEach, describe, expect, it } from "vitest";
import { readDefaultCloudPath, saveDefaultCloudPath } from "./defaultCloudPath";

beforeEach(() => window.localStorage.clear());

describe("default cloud paths", () => {
  it("isolates providers and accounts, including delimiter characters", () => {
    saveDefaultCloudPath("onedrive", "account-a", "照片/待整理");
    saveDefaultCloudPath("onedrive", "account-b", "文档");
    saveDefaultCloudPath("another-cloud", "account-a", "工作");
    saveDefaultCloudPath("a:b", "c", "one");
    saveDefaultCloudPath("a", "b:c", "two");
    expect(readDefaultCloudPath("onedrive", "account-a")).toBe("照片/待整理");
    expect(readDefaultCloudPath("onedrive", "account-b")).toBe("文档");
    expect(readDefaultCloudPath("another-cloud", "account-a")).toBe("工作");
    expect(readDefaultCloudPath("a:b", "c")).toBe("one");
    expect(readDefaultCloudPath("a", "b:c")).toBe("two");
  });

  it("replaces only the chosen account default and supports the root directory", () => {
    expect(readDefaultCloudPath("onedrive", "new-account")).toBe("");
    saveDefaultCloudPath("onedrive", "account-a", "old");
    saveDefaultCloudPath("onedrive", "account-b", "unchanged");
    saveDefaultCloudPath("onedrive", "account-a", "new");
    expect(readDefaultCloudPath("onedrive", "account-a")).toBe("new");
    saveDefaultCloudPath("onedrive", "account-a", "");
    expect(readDefaultCloudPath("onedrive", "account-a")).toBe("");
    expect(readDefaultCloudPath("onedrive", "account-b")).toBe("unchanged");
  });
});
