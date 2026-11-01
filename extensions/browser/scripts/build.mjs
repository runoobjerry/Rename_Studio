import { build } from "vite";
import { cp, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (!["production", "development"].includes(mode)) throw new Error("Specify production or development");
const root = fileURLToPath(new URL("../", import.meta.url));
const outDir = fileURLToPath(new URL(`../dist/${mode}/`, import.meta.url));
const origin = mode === "production" ? "http://localhost:8000" : "http://localhost:5173";
for (const [index, name] of ["material", "onedrive", "workspace", "service-worker"].entries()) {
  await build({
    configFile: false, root,
    define: { __WORKSPACE_ORIGIN__: JSON.stringify(origin) },
    build: {
      target: "chrome106", outDir, emptyOutDir: index === 0, minify: false,
      lib: { entry: `${root}src/${name === "material" ? "material-main" : name === "onedrive" ? "onedrive-content" : name === "workspace" ? "workspace-content" : name}.js`,
        name: "RenameStudioBrowser", formats: [name === "service-worker" ? "es" : "iife"],
        fileName: () => `${name}.js` },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
}
const manifest = JSON.parse(await readFile(`${root}manifest.json`, "utf8"));
if (mode === "development") manifest.name = "__MSG_developmentName__";
// Chrome match patterns cannot restrict ports. Runtime guards must match this single build origin.
await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
await writeFile(`${outDir}/workspace-origin.json`, JSON.stringify({ origin }) + "\n");
await cp(`${root}_locales`, `${outDir}/_locales`, { recursive: true });
await cp(`${root}icons`, `${outDir}/icons`, { recursive: true });
