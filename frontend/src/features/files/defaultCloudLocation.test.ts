import { describe, expect, it } from "vitest";
import type { AppPreferences } from "../../types";
import { readDefaultCloudLocation } from "./defaultCloudLocation";

describe("connection-scoped cloud directory", () => {
  it("isolates connections and accounts even when directory names match", () => {
    const preferences: AppPreferences = { language: "auto", theme: "system", cloud_default_locations: {
      one: { account_id: "account-a", location: { kind: "id", value: "opaque-one" } },
      two: { account_id: "account-b", location: { kind: "id", value: "opaque-two" } },
    } };
    expect(readDefaultCloudLocation(preferences, "one", "account-a")).toEqual({ kind: "id", value: "opaque-one" });
    expect(readDefaultCloudLocation(preferences, "two", "account-b")).toEqual({ kind: "id", value: "opaque-two" });
    expect(readDefaultCloudLocation(preferences, "one", "account-b")).toEqual({ kind: "root" });
    expect(readDefaultCloudLocation(preferences, "missing", "account-a")).toEqual({ kind: "root" });
  });
});
