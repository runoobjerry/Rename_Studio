import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const namespaces = ["common", "settings", "files", "rules", "providers", "errors"];
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// JSON.parse accepts duplicate properties. Inspect tokens as well so no translation is silently lost.
function parseJson(text) {
  const value = JSON.parse(text);
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  let index = 0;
  function visit() {
    const token = tokens[index++];
    if (token === "{") {
      const keys = new Set();
      while (tokens[index] !== "}") {
        const key = JSON.parse(tokens[index++]);
        if (keys.has(key)) throw new Error(`duplicate JSON key: ${key}`);
        keys.add(key);
        index++; // colon; syntax was already checked by JSON.parse
        visit();
        if (tokens[index] === ",") index++;
      }
      index++;
    } else if (token === "[") {
      while (tokens[index] !== "]") {
        visit();
        if (tokens[index] === ",") index++;
      }
      index++;
    }
  }
  visit();
  return value;
}

function flatten(value, prefix, leaves, shape, errors) {
  if (!object(value)) {
    errors.push(`${prefix}: expected an object`);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const path = `${prefix}${prefix.endsWith(":") ? "" : "."}${key}`;
    shape.set(path, object(entry) ? "object" : "string");
    if (!key || /[.:]/.test(key) || ["__proto__", "constructor", "prototype"].includes(key)) {
      errors.push(`${path}: invalid dictionary key`);
    } else if (object(entry)) flatten(entry, path, leaves, shape, errors);
    else if (typeof entry !== "string" || !entry.trim()) errors.push(`${path}: expected a non-empty string`);
    else leaves.set(path, entry);
  }
}

function placeholders(text) {
  const tokens = [...text.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((match) => match[1].trim()).sort();
  if (/[{}]{2}/.test(text.replace(/{{\s*([^{}]+?)\s*}}/g, ""))) throw new Error("malformed interpolation");
  return JSON.stringify(tokens);
}

export function checkLocales(localesRoot) {
  const errors = [], warnings = [], bundles = new Map(), shapes = new Map(), codes = new Set();
  const read = (path) => {
    try { return parseJson(readFileSync(path, "utf8")); }
    catch (error) { errors.push(`${relative(localesRoot, path)}: ${error.message}`); return undefined; }
  };
  for (const directory of readdirSync(localesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const code = directory.name;
    const meta = read(join(localesRoot, code, "meta.json"));
    if (meta !== undefined) {
      let canonical;
      try { [canonical] = Intl.getCanonicalLocales(meta?.code); } catch { /* reported below */ }
      if (!object(meta) || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(code) || code.length > 63 ||
          meta.code !== code || canonical !== code || code === "auto" ||
          typeof meta.name !== "string" || !meta.name.trim() || Object.keys(meta).some((key) => !["code", "name"].includes(key))) {
        errors.push(`${code}/meta.json: expected canonical BCP 47 code matching the directory and a non-empty name`);
      }
      if (typeof meta?.code === "string") {
        const identity = meta.code.toLowerCase();
        if (codes.has(identity)) errors.push(`${code}/meta.json: duplicate language code ${meta.code}`);
        codes.add(identity);
      }
    }
    const leaves = new Map(), shape = new Map();
    for (const namespace of namespaces) {
      const dictionary = read(join(localesRoot, code, `${namespace}.json`));
      if (dictionary !== undefined) flatten(dictionary, `${namespace}:`, leaves, shape, errors);
      if (code === "en-US" && object(dictionary) && !Object.keys(dictionary).length) errors.push(`en-US/${namespace}: default namespace must not be empty`);
    }
    for (const filename of readdirSync(join(localesRoot, code))) {
      if (filename.endsWith(".json") && !["meta.json", ...namespaces.map((ns) => `${ns}.json`)].includes(filename)) {
        errors.push(`${code}/${filename}: unknown namespace`);
      }
    }
    bundles.set(code, leaves);
    shapes.set(code, shape);
  }
  const english = bundles.get("en-US") ?? new Map();
  for (const code of ["en-US", "zh-CN"]) if (!bundles.has(code)) errors.push(`missing required language: ${code}`);
  if (!english.size) errors.push("en-US: the default dictionary must not be empty");
  for (const [code, leaves] of bundles) {
    for (const [key, kind] of shapes.get(code)) {
      if (shapes.get("en-US")?.get(key) !== kind) errors.push(`${code}/${key}: unknown key or incompatible structure`);
    }
    for (const [key, text] of leaves) {
      try {
        if (english.has(key) && placeholders(text) !== placeholders(english.get(key))) errors.push(`${code}/${key}: interpolation placeholders differ from en-US`);
      } catch (error) { errors.push(`${code}/${key}: ${error.message}`); }
    }
    const missing = [...english.keys()].filter((key) => !leaves.has(key));
    if (missing.length) {
      const message = `${code}: ${missing.length} missing keys (fallback en-US)\n  ${missing.join("\n  ")}`;
      (code === "zh-CN" ? errors : warnings).push(message);
    }
  }
  return { errors, warnings, bundles };
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["locales", "test", "__fixtures__"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [path] : [];
  });
}

export function scanSource(text, filename) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const required = new Set(), dynamic = new Set(), errors = [];
  const scopes = new Map();
  function scopeOf(node) {
    while (!ts.isFunctionLike(node) && !ts.isSourceFile(node)) node = node.parent;
    return node;
  }
  function findNamespace(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useTranslation") {
      if (!node.arguments[0]) scopes.set(scopeOf(node), "common");
      else if (ts.isStringLiteral(node.arguments[0])) scopes.set(scopeOf(node), node.arguments[0].text);
      else errors.push(`${filename}: non-literal namespace requires scanner support`);
    }
    ts.forEachChild(node, findNamespace);
  }
  findNamespace(source);
  function namespaceAt(node) {
    for (let parent = node; parent; parent = parent.parent) if (scopes.has(parent)) return scopes.get(parent);
    return "common";
  }
  function keys(node, namespace) {
    if (!node) return;
    if (ts.isStringLiteralLike(node)) required.add(node.text.includes(":") ? node.text : `${namespace}:${node.text}`);
    else if (ts.isConditionalExpression(node)) { keys(node.whenTrue, namespace); keys(node.whenFalse, namespace); }
    else if (ts.isArrayLiteralExpression(node)) node.elements.forEach((element) => keys(element, namespace));
    else dynamic.add(`${filename}: ${node.getText(source)}`);
  }
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "translatedCodes" && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      for (const code of node.initializer.elements) {
        if (ts.isStringLiteral(code)) required.add(`errors:codes.${code.text}`);
        else errors.push(`${filename}: translatedCodes requires literal strings`);
      }
    }
    if (ts.isInterfaceDeclaration(node) && node.name.text === "RenameProgress") {
      const phase = node.members.find((member) => member.name?.getText(source) === "phase");
      if (!phase?.type || !ts.isUnionTypeNode(phase.type)) errors.push(`${filename}: RenameProgress.phase requires scanner support`);
      else for (const type of phase.type.types) {
        if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) required.add(`files:rename.phases.${type.literal.text}`);
        else errors.push(`${filename}: RenameProgress.phase must use literal strings`);
      }
    }
    if (ts.isCallExpression(node) && /^(?:t|i18n\.t)$/.test(node.expression.getText(source))) keys(node.arguments[0], node.expression.getText(source) === "i18n.t" ? "common" : namespaceAt(node));
    // Also includes notification descriptors and labelKey maps outside calls to t().
    if (ts.isStringLiteralLike(node) && namespaces.some((ns) => node.text.startsWith(`${ns}:`)) && /^[a-z]+:[\w.]+$/.test(node.text)) required.add(node.text);
    if (ts.isStringLiteralLike(node) && ts.isPropertyAssignment(node.parent) && /^(key|labelKey)$/.test(node.parent.name.getText(source)) && node.text.includes(":")) required.add(node.text);
    if ((ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && /\p{Script=Han}/u.test(node.text)) {
      errors.push(`${filename}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: Chinese UI literal must move to zh-CN`);
    } else if (ts.isJsxText(node) && /\p{Letter}/u.test(node.text) && !["Rename Studio", "v"].includes(node.text.trim())) {
      errors.push(`${filename}: JSX text must use a translation key: ${node.text.trim()}`);
    }
    if (ts.isJsxAttribute(node) && /^(aria-label|title|label|placeholder|alt)$/.test(node.name.getText(source)) &&
        node.initializer && ts.isStringLiteral(node.initializer) && /\p{Letter}/u.test(node.initializer.text) && !/\p{Script=Han}/u.test(node.initializer.text)) {
      errors.push(`${filename}: UI attribute must use a translation key: ${node.getText(source)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { required, dynamic, errors };
}

// Deliberately reads the current explicit registration syntax, not a general Python interpreter.
// Fail on unrecognized registrations/fields instead of silently claiming dynamic-key coverage.
export function metadataKeys(backendRoot) {
  const read = (path) => readFileSync(join(backendRoot, path), "utf8");
  const required = new Set();
  const dependencies = read("api/dependencies.py");
  const rulesBody = dependencies.match(/def get_rule_registry\(\)[\s\S]*?(?=\n(?:@|def )|$)/)?.[0];
  if (!rulesBody) throw new Error("cannot locate rule registrations");
  const rules = [...rulesBody.matchAll(/registry\.register\((\w+)\(\)\)/g)];
  if (!rules.length || rules.length !== (rulesBody.match(/registry\.register\(/g) ?? []).length) throw new Error("unsupported rule registration syntax");
  for (const [, name] of rules) {
    const module = [...dependencies.matchAll(/^from app\.(rules\.[\w.]+) import ([\w, ]+)$/gm)].find((match) => match[2].split(",").map((part) => part.trim()).includes(name));
    if (!module) throw new Error(`cannot resolve registered rule ${name}`);
    const body = read(`${module[1].replaceAll(".", "/")}.py`).match(new RegExp(`class ${name}\\([^]*?(?=\\nclass |$)`))?.[0];
    const type = body?.match(/^    type = ["']([^"']+)["']/m)?.[1];
    if (!type) throw new Error(`cannot read stable type for ${name}`);
    required.add(`rules:types.${type}.name`);
    required.add(`rules:types.${type}.description`);
  }
  const builtin = read("providers/builtin.py");
  const providers = [...builtin.matchAll(/registry\.register\((\w+)\(settings\)\)/g)];
  if (!providers.length || providers.length !== (builtin.match(/registry\.register\(/g) ?? []).length) throw new Error("unsupported provider registration syntax");
  for (const [, alias] of providers) {
    const module = [...builtin.matchAll(/^from app\.(providers\.[\w.]+) import get_definition as (\w+)$/gm)].find((match) => match[2] === alias);
    if (!module) throw new Error(`cannot resolve registered provider ${alias}`);
    const definition = read(`${module[1].replaceAll(".", "/")}.py`);
    const type = definition.match(/return ProviderDefinition\(\s*["']([^"']+)["']/)?.[1];
    if (!type) throw new Error(`cannot read stable provider type for ${alias}`);
    required.add(`providers:${type}.name`);
    required.add(`providers:${type}.accountLabel`);
    const fields = [...definition.matchAll(/StorageConfigField\(\s*key=["']([^"']+)["']/g)];
    if (fields.length !== (definition.match(/StorageConfigField\(/g) ?? []).length) throw new Error(`unsupported config field syntax for ${type}`);
    for (const [, key] of fields) required.add(`providers:${type}.fields.${key}.label`);
  }
  return required;
}

export function checkProject(root = projectRoot) {
  const result = checkLocales(join(root, "frontend/src/locales"));
  const required = new Set(), dynamic = new Set();
  for (const file of sourceFiles(join(root, "frontend/src"))) {
    const scan = scanSource(readFileSync(file, "utf8"), relative(root, file));
    scan.required.forEach((key) => required.add(key));
    scan.dynamic.forEach((key) => dynamic.add(key));
    result.errors.push(...scan.errors);
  }
  try { metadataKeys(join(root, "backend/app")).forEach((key) => required.add(key)); }
  catch (error) { result.errors.push(`Rule/Provider metadata: ${error.message}`); }
  for (const key of required) {
    if (!result.bundles.get("en-US")?.has(key)) result.errors.push(`en-US: missing required code/metadata key ${key}`);
  }
  const total = result.bundles.get("en-US")?.size ?? 0;
  const coverage = [...result.bundles].map(([code, leaves]) => `${code} ${leaves.size}/${total}`).join(", ");
  result.summary = `${result.bundles.size} languages (${coverage}); ${required.size} static/metadata keys; ${dynamic.size} dynamic expressions require review`;
  result.warnings.push(...dynamic);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkProject();
    for (const message of result.warnings) console.warn(`[i18n review] ${message}`);
    for (const message of result.errors) console.error(`[i18n error] ${message}`);
    console.log(`[i18n] ${result.summary}; ${result.errors.length} errors`);
    if (result.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(`[i18n error] ${error.message}`);
    process.exitCode = 1;
  }
}
