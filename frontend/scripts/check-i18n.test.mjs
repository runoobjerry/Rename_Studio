import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkLocales, checkProject, metadataKeys, namespaces, scanSource } from "./check-i18n.mjs";

let root;
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
};
const localeRoot = () => join(root, "frontend/src/locales");
const dictionary = (code, ns, value) => write(join(localeRoot(), code, `${ns}.json`), value);
function language(code) {
  dictionary(code, "meta", { code, name: code });
  for (const ns of namespaces) dictionary(code, ns, { message: "{{count}} items" });
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rename-studio-i18n-"));
  language("en-US");
  language("zh-CN");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("translation validation", () => {
  it("accepts partial community languages and lists missing keys", () => {
    language("fr-FR");
    for (const ns of namespaces) dictionary("fr-FR", ns, {});
    dictionary("fr-FR", "common", { message: "{{count}} éléments" });
    const result = checkLocales(localeRoot());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("fr-FR: 5 missing keys");
    expect(result.warnings[0]).toContain("settings:message");
    expect(result.warnings[0]).not.toContain("common:message");
  });

  it.each([
    ["invalid JSON", "common", '{"message":}', /JSON/],
    ["duplicate properties", "common", '{"message":"first","message":"second"}', /duplicate JSON key/],
    ["escaped duplicate properties", "common", '{"message":"first","\\u006dessage":"second"}', /duplicate JSON key/],
    ["wrong code", "meta", { code: "en-US", name: "Chinese" }, /duplicate language code/],
    ["invalid code", "meta", { code: "zh_CN", name: "Chinese" }, /canonical BCP 47/],
    ["missing name", "meta", { code: "zh-CN", name: " " }, /non-empty name/],
    ["null metadata", "meta", "null", /canonical BCP 47/],
    ["incompatible leaf", "common", { message: { nested: "text" } }, /incompatible structure/],
    ["empty incompatible branch", "common", { message: {} }, /incompatible structure/],
    ["non-string leaf", "common", { message: 123 }, /non-empty string/],
    ["unknown key", "common", { message: "{{count}}", other: "text" }, /unknown key/],
    ["wrong placeholder", "common", { message: "{{total}} items" }, /placeholders differ/],
    ["malformed placeholder", "common", { message: "{{count} items" }, /malformed interpolation/],
    ["Chinese missing key", "common", {}, /zh-CN: 1 missing keys/],
  ])("rejects %s", (_name, ns, value, error) => {
    dictionary("zh-CN", ns, value);
    expect(checkLocales(localeRoot()).errors.join("\n")).toMatch(error);
  });

  it("requires every namespace even for a partial language", () => {
    language("fr-FR");
    rmSync(join(localeRoot(), "fr-FR/files.json"));
    expect(checkLocales(localeRoot()).errors.join("\n")).toContain(join("fr-FR", "files.json"));
  });

  it("rejects invalid and noncanonical directory identifiers", () => {
    for (const code of ["auto", "en-us", "xx_YY"]) language(code);
    expect(checkLocales(localeRoot()).errors.filter((error) => error.includes("canonical BCP 47"))).toHaveLength(3);
  });

  it("checks placeholders in the English source as well", () => {
    dictionary("en-US", "common", { message: "{{count}" });
    expect(checkLocales(localeRoot()).errors.join("\n")).toContain("en-US/common:message: malformed interpolation");
  });

});

describe("code and registered metadata coverage", () => {
  function backend() {
    write(join(root, "backend/app/api/dependencies.py"), `from app.rules.demo import DemoRule
def get_rule_registry() -> RuleRegistry:
    registry.register(DemoRule())
    return registry
`);
    write(join(root, "backend/app/rules/demo.py"), `class DemoRule(RenameRule):
    type = "demo_rule"
`);
    write(join(root, "backend/app/providers/builtin.py"), `from app.providers.demo.definition import get_definition as demo_definition
def register_builtin_providers(registry, settings):
    registry.register(demo_definition(settings))
`);
    write(join(root, "backend/app/providers/demo/definition.py"), `def get_definition(settings):
    return ProviderDefinition("demo_provider", Model, ("root",), factory,
        config_fields=(StorageConfigField(key="raw_path"),))
`);
    return join(root, "backend/app");
  }

  it("finds calls, conditional keys, notifications, phases and errors, and reports dynamic expressions", () => {
    const scan = scanSource(`const { t } = useTranslation("settings");
      t("title"); t(flag ? "common:save" : "common:cancel"); t(["files:title", "common:close"]);
      const notice = { key: "files:notifications.refreshed" }; const url = "about:blank";
      const translatedCodes = ["DEMO_ERROR"];
      interface RenameProgress { phase: "waiting" | "finished" }
      function Other() { const { t } = useTranslation(); t("loadingPage"); }
      t(variable); t(\`providers:\${type}.name\`);
    `, "Probe.tsx");
    expect(scan.errors).toEqual([]);
    expect([...scan.required]).toEqual(expect.arrayContaining([
      "settings:title", "common:save", "common:cancel", "common:close", "common:loadingPage", "files:title",
      "files:notifications.refreshed", "errors:codes.DEMO_ERROR", "files:rename.phases.finished",
    ]));
    expect(scan.required.has("about:blank")).toBe(false);
    expect(scan.dynamic.size).toBe(2);
    expect(scanSource('const ui = <button title="中文">硬编码</button>;', "Probe.tsx").errors).toHaveLength(2);
    expect(scanSource('const ui = <button aria-label="Untranslated">Press me</button>;', "Probe.tsx").errors).toHaveLength(2);
  });

  it("requires translations for newly registered extension types and fields", () => {
    expect([...metadataKeys(backend())]).toEqual([
      "rules:types.demo_rule.name", "rules:types.demo_rule.description", "providers:demo_provider.name",
      "providers:demo_provider.accountLabel", "providers:demo_provider.fields.raw_path.label",
    ]);
    write(join(root, "frontend/src/Probe.tsx"), 't("common:missingRequired");');
    const errors = checkProject(root).errors.join("\n");
    expect(errors).toContain("missing required code/metadata key common:missingRequired");
    expect(errors).toContain("missing required code/metadata key providers:demo_provider.fields.raw_path.label");
  });

  it("fails visibly if registration syntax changes instead of skipping metadata coverage", () => {
    const backendRoot = backend();
    const path = join(backendRoot, "providers/builtin.py");
    write(path, readFileSync(path, "utf8").replace("demo_definition(settings)", "create_dynamic_definition(settings)"));
    expect(() => metadataKeys(backendRoot)).toThrow("cannot resolve registered provider");
  });

  it("checks the repository dictionaries and registrations together", () => {
    const result = checkProject(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
    expect(result.errors).toEqual([]);
    expect(result.summary).toContain("dynamic expressions require review");
  });
});
