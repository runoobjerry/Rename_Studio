import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const resource = /^frontend\/src\/locales\/[^/]+\/(meta|common|settings|files|rules|providers|errors)\.json$/;
const affectsFrontend = (path) => path.startsWith("frontend/") ||
  path.startsWith("backend/app/rules/") || path.startsWith("backend/app/providers/") ||
  path === "backend/app/api/dependencies.py" || path === ".github/workflows/frontend-ci.yml";

// 默认词典键结构变化会影响调用方，必须走全量检查；属性顺序和译文不参与结构比较。
function shape(value) {
  if (value === null || typeof value !== "object") return typeof value;
  if (Array.isArray(value)) return "array";
  return Object.keys(value).sort().map((key) => [key, shape(value[key])]);
}

export function classifyChanges(changes, readBase, readHead) {
  if (!changes.some(({ path }) => affectsFrontend(path))) return "skip";
  for (const { status, path } of changes) {
    // 整个 PR 都必须符合翻译约定；混合变更不能走翻译快速路径。
    if (!["A", "M"].includes(status) || !resource.test(path)) return "full";
    if (path.startsWith("frontend/src/locales/en-US/") && !path.endsWith("/meta.json")) {
      if (status !== "M") return "full";
      const before = shape(JSON.parse(readBase(path)));
      const after = shape(JSON.parse(readHead(path)));
      if (JSON.stringify(before) !== JSON.stringify(after)) return "full";
    }
  }
  return "translations";
}

export function detectScope(eventName, baseSha, git) {
  if (eventName !== "pull_request") return "full";
  const base = git("merge-base", baseSha, "HEAD").trim();
  // 禁用重命名识别，使旧路径以删除项出现；移出前端目录也不会漏检。
  const fields = git("diff", "--no-renames", "--name-status", "-z", base, "HEAD").split("\0");
  fields.pop();
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    changes.push({ status: fields[index], path: fields[index + 1] });
  }
  return classifyChanges(changes, (path) => git("show", `${base}:${path}`), (path) => git("show", `HEAD:${path}`));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
  const scope = detectScope(process.env.GITHUB_EVENT_NAME, process.env.BASE_SHA, git);
  appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\n`);
  console.log(`Frontend CI scope: ${scope}`);
}
