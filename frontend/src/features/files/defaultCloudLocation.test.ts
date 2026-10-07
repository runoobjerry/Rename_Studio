import { beforeEach, describe, expect, it } from "vitest";
import { readDefaultCloudLocation, saveDefaultCloudLocation } from "./defaultCloudLocation";

beforeEach(() => window.localStorage.clear());

describe("connection-scoped cloud directory", () => {
  it("isolates connections and accounts even when directory names match", () => {
    saveDefaultCloudLocation("one", "account-a", { kind: "id", value: "opaque-one" });
    saveDefaultCloudLocation("two", "account-a", { kind: "id", value: "opaque-two" });
    expect(readDefaultCloudLocation("one", "account-a")).toEqual({ kind: "id", value: "opaque-one" });
    expect(readDefaultCloudLocation("two", "account-a")).toEqual({ kind: "id", value: "opaque-two" });
    expect(readDefaultCloudLocation("one", "account-b")).toEqual({ kind: "root" });
  });
  it("ignores the removed provider-scoped path setting", () => {
    window.localStorage.setItem('renamer-default-cloud-path:["onedrive","account"]', "Photos");
    expect(readDefaultCloudLocation("cloud-connection", "account")).toEqual({ kind: "root" });
  });
});
