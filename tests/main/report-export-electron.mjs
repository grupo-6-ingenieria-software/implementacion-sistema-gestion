import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = resolve("out/cu54-qa");
await mkdir(output, { recursive: true });
const entry = resolve(output, "electron-report-test.mjs");
const require = createRequire(import.meta.url);
await build({
  entryPoints: ["tests/main/report-export-electron-entry.ts"], outfile: entry,
  bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic", target: "node22",
  plugins: [{ name: "electron-log-esm-path", setup(builder) {
    builder.onResolve({ filter: /^electron-log\/main$/ }, () => ({ path: pathToFileURL(require.resolve("electron-log/main")).href, external: true }));
  } }],
});
const bootstrap = resolve(output, "electron-report-bootstrap.cjs");
const resultPath = resolve(output, "electron-result.json");
await writeFile(resultPath, JSON.stringify({ ok: false, phase: "starting" }));
await writeFile(bootstrap, `
const { app, dialog } = require("electron");
const { writeFileSync } = require("node:fs");
app.on("window-all-closed", () => {});
function fail(error) {
  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ ok: false, error: String(error.stack || error) }));
  app.exit(1);
}
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
dialog.showErrorBox = (title, content) => fail(new Error(title + ": " + content));
import(${JSON.stringify(pathToFileURL(entry).href)}).catch(fail);
`);
const env = { ...process.env, DATABASE_URL: "file::memory:", DATABASE_AUTH_TOKEN: "" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [bootstrap], { cwd: process.cwd(), env, windowsHide: true, stdio: "pipe" });
let diagnostics = "";
child.stdout.on("data", (chunk) => { diagnostics += chunk.toString(); });
child.stderr.on("data", (chunk) => { diagnostics += chunk.toString(); });
const timeout = setTimeout(() => child.kill(), 60000);
try {
  const code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(code, 0, `${JSON.stringify(result)}\n${diagnostics}`);
  assert.equal(result.ok, true, JSON.stringify(result));
  console.log(`PASS CU54 Electron: ${result.rows} días, PDF con gráfico, XLSX numérico, nombre fijo y ${result.audits} auditorías confirmadas (selector de carpeta simulado).`);
  console.log(`Archivos de prueba: ${output}`);
} finally { clearTimeout(timeout); }
