import { beforeEach, describe, expect, it } from "vitest";
import { readDefaultCloudLocation, saveDefaultCloudLocation, saveDefaultCloudPath } from "./defaultCloudPath";

beforeEach(() => window.localStorage.clear());

describe("connection-scoped cloud directory", () => {
  it("isolates connections and accounts even when directory names match", () => {
    saveDefaultCloudLocation("one", "account-a", { kind: "id", value: "opaque-one" });
    saveDefaultCloudLocation("two", "account-a", { kind: "id", value: "opaque-two" });
    expect(readDefaultCloudLocation("one", "onedrive", "account-a")).toEqual({ kind: "id", value: "opaque-one" });
    expect(readDefaultCloudLocation("two", "onedrive", "account-a")).toEqual({ kind: "id", value: "opaque-two" });
    expect(readDefaultCloudLocation("one", "onedrive", "account-b")).toEqual({ kind: "root" });
  });
  it("migrates the old path only for the default OneDrive connection", () => {
    saveDefaultCloudPath("onedrive", "account", "Photos");
    expect(readDefaultCloudLocation("default-onedrive", "onedrive", "account")).toEqual({ kind: "path", value: "Photos" });
    expect(readDefaultCloudLocation("new-connection", "onedrive", "account")).toEqual({ kind: "root" });
    saveDefaultCloudLocation("default-onedrive", "account", { kind: "id", value: "folder-id" });
    expect(readDefaultCloudLocation("default-onedrive", "onedrive", "account")).toEqual({ kind: "id", value: "folder-id" });
  });
});
