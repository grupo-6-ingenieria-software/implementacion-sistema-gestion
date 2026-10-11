// Ejecuta las pruebas que no corren con `npm test`: scripts de UI con
// Playwright (tests/renderer/*-ui.mjs|mts), el test de inventario en Chromium
// (config propia de Vitest) y las exportaciones en Electron (tests/main/*-electron.mjs).
//
// Uso:
//   npm run test:ui               todo
//   npm run test:ui -- cu28 rf59  solo los scripts cuyo nombre contiene esos textos
//   npm run test:ui -- --jobs 3   scripts de UI en paralelo (por defecto 1). En paralelo es
//                                 más rápido pero inestable: los servidores Vite comparten la
//                                 caché de dependencias y algunos scripts agotan su timeout.
//
// Requiere Chromium de Playwright: `npx playwright install chromium`.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = (name) => join(root, "node_modules", ".bin", name);
const color = (style, text) => styleText(style, text, { stream: process.stdout });
const secs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

const argv = process.argv.slice(2);
const jobsAt = argv.indexOf("--jobs");
const jobs = jobsAt >= 0 ? Math.max(1, Number(argv[jobsAt + 1]) || 1) : 1;
const filters = argv.filter((a, i) => !a.startsWith("--") && !(jobsAt >= 0 && i === jobsAt + 1)).map((a) => a.toLowerCase());
const wanted = (file) => !filters.length || filters.some((f) => file.toLowerCase().includes(f));

const list = (dir, re) =>
  readdirSync(join(root, dir))
    .filter((f) => re.test(f))
    .sort()
    .map((f) => join(dir, f));

// La mayoría de los scripts importan src/ sin extensión y necesitan tsx. Los que
// declaran "native TypeScript support" en su cabecera deben correr con node:
// tsx envuelve las funciones nombradas con un helper __name que no existe en
// las funciones que Playwright serializa al navegador.
const nativeTs = (file) => /native TypeScript support/.test(readFileSync(join(root, file), "utf8").slice(0, 2000));

const groups = [
  {
    label: "Playwright UI",
    parallel: jobs,
    // inventory-ui.mts solo envuelve la config de Vitest del grupo siguiente.
    items: list("tests/renderer", /-ui\.m[jt]s$/)
      .filter((file) => !file.endsWith("inventory-ui.mts"))
      .map((file) => (nativeTs(file) ? { file, cmd: process.execPath, args: [file] } : { file, cmd: bin("tsx"), args: [file] })),
  },
  {
    label: "Chromium (Vitest)",
    parallel: 1,
    items: [{ file: "tests/renderer/inventory-ui.chromium.ts", cmd: bin("vitest"), args: ["run", "-c", "tests/renderer/inventory-ui.vitest.config.ts"] }],
  },
  {
    label: "Electron",
    parallel: 1,
    items: list("tests/main", /-electron\.mjs$/).map((file) => ({ file, cmd: process.execPath, args: [file] })),
  },
];

const TIMEOUT = 5 * 60 * 1000;

function run({ cmd, args }) {
  return new Promise((done) => {
    const started = performance.now();
    const child = spawn(cmd, args, { cwd: root, env: { ...process.env, FORCE_COLOR: "0" } });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      done({ ok: code === 0, code, signal, output, elapsed: performance.now() - started });
    });
  });
}

// Línea que resume el resultado: la última salida propia del script, sin ruido
// de Vite, avisos de Node ni las rutas de capturas.
function summaryOf(output) {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .map((l) => l.replace(/\s*(Capturas|Screenshots|Archivos de prueba):.*$/, ""))
    .filter((l) => l && !/\[vite\]|deprecat|^\(Use `node|^Port \d+ is in use|^Duration|^Start at/i.test(l));
  return lines.at(-1) ?? "";
}

function printLine(file, result) {
  const icon = result.ok ? color("green", "✓") : color("red", "×");
  const time = secs(result.elapsed);
  let summary = result.ok ? summaryOf(result.output) : result.signal === "SIGKILL" ? "tiempo agotado" : `salió con código ${result.code}`;
  const width = process.stdout.columns;
  const room = width ? width - file.length - time.length - 6 : Infinity;
  if (summary.length > room) summary = room > 10 ? `${summary.slice(0, room - 1)}…` : "";
  console.log(` ${icon} ${color("dim", file)} ${summary} ${color("dim", time)}`);
  if (!result.ok) {
    for (const l of result.output.trimEnd().split("\n").slice(-15)) console.log(color("red", `     ${l}`));
  }
}

const results = [];
for (const group of groups) {
  const items = group.items.filter((i) => wanted(i.file));
  if (!items.length) continue;
  console.log(color("bold", `\n=== ${group.label} ===`));
  const started = performance.now();
  const queue = [...items];
  let passed = 0;
  let failed = 0;
  await Promise.all(
    Array.from({ length: Math.min(group.parallel, items.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const result = await run(item);
        printLine(relative(root, join(root, item.file)), result);
        result.ok ? passed++ : failed++;
        results.push({ file: item.file, ok: result.ok });
      }
    }),
  );
  const summary = [color("green", `${passed} aprobados`)];
  if (failed) summary.push(color("red", `${failed} fallidos`));
  console.log(`   ${summary.join(color("dim", " | "))} ${color("dim", `(${secs(performance.now() - started)})`)}`);
}

const bad = results.filter((r) => !r.ok);
console.log(
  `\n ${color("bold", "Scripts")} ${color("green", `${results.length - bad.length} aprobados`)}${bad.length ? color("red", ` | ${bad.length} fallidos`) : ""}` +
    (bad.length ? `\n ${color("bold", "Fallos")}  ${color("red", bad.map((r) => r.file).join(", "))}` : ""),
);
process.exit(bad.length ? 1 : 0);
