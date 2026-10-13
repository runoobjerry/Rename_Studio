import { describe, expect, it } from "vitest";
import type { AppPreferences } from "../../types";
import { readDefaultCloudLocation } from "./defaultCloudLocation";

describe("connection-scoped cloud directory", () => {
  it("isolates connections and accounts even when directory names match", () => {
    const preferences: AppPreferences = { theme: "system", hide_batch_limit_hint: false, cloud_default_locations: {
      one: { account_id: "account-a", location: { kind: "id", value: "opaque-one" } },
      two: { account_id: "account-a", location: { kind: "id", value: "opaque-two" } },
    } };
    expect(readDefaultCloudLocation(preferences, "one", "account-a")).toEqual({ kind: "id", value: "opaque-one" });
    expect(readDefaultCloudLocation(preferences, "two", "account-a")).toEqual({ kind: "id", value: "opaque-two" });
    expect(readDefaultCloudLocation(preferences, "one", "account-b")).toEqual({ kind: "root" });
    expect(readDefaultCloudLocation(preferences, "missing", "account-a")).toEqual({ kind: "root" });
  });
});
