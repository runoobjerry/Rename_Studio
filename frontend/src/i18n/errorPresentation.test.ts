import { describe, expect, it } from "vitest";
import { resolveErrorPresentation, type PresentationError } from "./errorPresentation";

const error = (overrides: Partial<PresentationError>): PresentationError => ({ message: "Diagnostic only", ...overrides });

describe("error presentation without translation or UI", () => {
  it("reuses a user meaning for different API classifications", () => {
    for (const code of ["APPLICATION_ERROR", "INTERNAL_ERROR"]) {
      expect(resolveErrorPresentation(error({ code }))).toEqual({ key: "errors:operationUnavailable" });
    }
  });

  it.each([
    ["NOT_FOUND", undefined, "errors:itemMissing"],
    ["NOT_FOUND", "directory", "errors:directoryMissing"],
    ["NOT_FOUND", "storage", "errors:storageMissing"],
    ["PROVIDER_ERROR", "settings", "errors:settingsUnavailable"],
    ["PROVIDER_ERROR", "storage", "errors:storageUnavailable"],
    ["VALIDATION_ERROR", "directory", "errors:locationInvalid"],
    ["VALIDATION_ERROR", "settings", "errors:inputInvalid"],
    ["PERMISSION_DENIED", "directory", "errors:accessDenied"],
    ["STORAGE_CONNECTION_CHANGED", "singleRename", "errors:storageRefreshRequired"],
  ] as const)("presents %s in %s as %s", (code, context, key) => {
    expect(resolveErrorPresentation(error({ code }), context)).toEqual({ key });
  });

  it("keeps precise reasons ahead of context, and requires the matching API category", () => {
    const details = { reason: "LOCATION_OUTSIDE_ROOT" };
    expect(resolveErrorPresentation(error({ code: "VALIDATION_ERROR", details }), "directory"))
      .toEqual({ key: "errors:outsideRoot" });
    expect(resolveErrorPresentation(error({ code: "PROVIDER_ERROR", details }), "directory"))
      .toEqual({ key: "errors:storageServiceUnavailable" });
    expect(resolveErrorPresentation(error({ code: "VALIDATION_ERROR", details: { reason: "FUTURE_REASON" } }), "directory"))
      .toEqual({ key: "errors:locationInvalid" });
  });

  it.each(["directory", "settings", "storage", "singleRename"] as const)("keeps unknown writes ahead of %s overrides and reasons", (context) => {
    expect(resolveErrorPresentation(error({ code: "RENAME_OUTCOME_UNKNOWN", status: 502,
      operation: "write", details: { execution_started: false } }), context)).toEqual({ key: "files:verification.required" });
    for (const status of [0, 502]) {
      expect(resolveErrorPresentation(error({ code: "PROVIDER_ERROR", status, operation: "write",
        details: { reason: "CONNECTION_NOT_FOUND" } }), context)).toEqual({ key: "errors:writeUnknown" });
    }
  });

  it("distinguishes pre-write revalidation, confirmed item errors and failed reads from lost writes", () => {
    expect(resolveErrorPresentation(error({ code: "PROVIDER_ERROR", status: 502, operation: "write",
      details: { execution_started: false } }))).toEqual({ key: "errors:storageServiceUnavailable" });
    expect(resolveErrorPresentation(error({ code: "PERMISSION_DENIED", status: 403, operation: "write" })))
      .toEqual({ key: "errors:renamePermissionDenied" });
    expect(resolveErrorPresentation(error({ code: "PROVIDER_ERROR", operation: "write" })))
      .toEqual({ key: "errors:storageServiceUnavailable" });
    expect(resolveErrorPresentation(error({ code: "PROVIDER_ERROR", status: 502, operation: "read" })))
      .toEqual({ key: "errors:storageServiceUnavailable" });
  });

  it.each([
    ["PREVIEW_DUPLICATE_FILE_IDS", "errors:selectionDuplicated"],
    ["PREVIEW_ITEMS_NOT_IN_DIRECTORY", "errors:selectionOutsideDirectory"],
    ["SOURCE_CHANGED", "errors:fileChanged"],
  ])("keeps the specialized %s presentation", (reason, key) => {
    expect(resolveErrorPresentation(error({ code: reason === "SOURCE_CHANGED" ? "RENAME_CONFLICT" : "VALIDATION_ERROR",
      details: { reason } }))).toEqual({ key });
  });

  it.each([
    ["name", "missing", "errors:storageNameEmpty"],
    ["name", "string_too_long", "errors:storageNameLength"],
    ["target_name", "string_too_short", "errors:nameEmpty"],
    ["new_name", "missing", "errors:nameEmpty"],
    ["client_secret", "string_type", "errors:clientSecret"],
  ])("retains request field guidance for %s / %s", (field, type, key) => {
    expect(resolveErrorPresentation(error({ code: "REQUEST_VALIDATION_ERROR",
      details: { errors: [{ loc: ["body", field], type }] } }), "settings")).toEqual({ key });
  });

  it("shows the affected item and allowed range when sequence numbering overflows", () => {
    expect(resolveErrorPresentation(error({ code: "RULE_CONFIGURATION_ERROR", status: 422,
      details: { reason: "SERIALIZE_NUMBER_OUT_OF_RANGE", params: { item: 2, min: 1, max: 3999 } },
    }))).toEqual({ key: "errors:serializeNumberOutOfRange", values: { item: 2, min: 1, max: 3999 } });
  });

  it("passes only display values, never backend-controlled translation options or objects", () => {
    expect(resolveErrorPresentation(error({ code: "VALIDATION_ERROR", details: { reason: "NAME_TOO_LONG",
      params: { max_length: 255, lng: "zh-CN", defaultValue: "Raw diagnostic", interpolation: { escapeValue: false } } } })))
      .toEqual({ key: "errors:nameLength", values: { max_length: 255 } });
    expect(resolveErrorPresentation(error({ code: "VALIDATION_ERROR", details: { reason: "NAME_TOO_LONG",
      params: { max_length: { secret: "not displayable" } } } }))).toEqual({ key: "errors:nameLength", values: {} });
    expect(resolveErrorPresentation(error({ code: "VALIDATION_ERROR", details: { reason: "NAME_INVALID_CHARACTERS",
      params: { characters: ["<", ">"], control_characters: "0-31" } } })))
      .toEqual({ key: "errors:nameCharacters", values: { characters: "< >", control_characters: "0-31" } });
    expect(resolveErrorPresentation(error({ code: "VALIDATION_ERROR", details: { reason: "ONEDRIVE_NAME_INVALID_PREFIX",
      params: { prefixes: ["~$", " ~"] } } }))).toEqual({ key: "errors:oneDriveStart", values: { prefixes: '"~$" " ~"' } });
  });

  it("uses safe fallbacks without inferring categories from diagnostics", () => {
    expect(resolveErrorPresentation(error({ code: "FUTURE_CODE", details: { graph_status: 401 },
      message: "Authentication failed" }), "settings")).toEqual({ key: "errors:readUnavailable" });
    expect(resolveErrorPresentation(error({ code: "FUTURE_CODE", operation: "write" })))
      .toEqual({ key: "errors:operationUnavailable" });
    expect(resolveErrorPresentation(new Error("Secret backend diagnostics"))).toEqual({ key: "errors:readUnavailable" });
  });
});
