// Ejecuta la suite de Vitest agrupada por requisito funcional, en orden
// RF01 → RF62 y al final TRANSVERSAL. El mapeo test → RF vive en rf-map.json.
//
// Uso:
//   npm test                 todos los RF en orden
//   npm test -- RF36 RF59    solo esos RF (también acepta 36 59)
//
// Cada test corre una sola vez, bajo su RF principal. Usa una sola instancia
// de Vitest para no pagar el arranque en cada RF. En la corrida completa, los
// tests que existen pero no están en el mapeo se ejecutan al final como
// "SIN RF" y las entradas del mapeo que ya no existen se informan como aviso.
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";
import { createVitest } from "vitest/node";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const map = JSON.parse(readFileSync(join(here, "rf-map.json"), "utf8"));

const wanted = new Set(
  process.argv.slice(2).map((a) => {
    const n = a.toUpperCase().replace(/^RF\s*/, "");
    return /^\d+$/.test(n) ? `RF${n.padStart(2, "0")}` : n;
  }),
);
const fullRun = wanted.size === 0;

// Vitest nombra los tests como "describe > test", pero el filtro por nombre
// compara contra los nombres unidos por espacios.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const namePattern = (name) => escape(name).replaceAll(" > ", " (?:> )?");
const key = (file, test) => `${file}\u0000${test}`;

const color = (style, text) => styleText(style, text, { stream: process.stdout });
const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

// Una línea por test, al estilo del reporter de Vitest, recortada al ancho de
// la terminal para que nunca ocupe más de una línea.
function printTest(test) {
  const { state, errors } = test.result();
  if (state === "skipped" || state === "pending") return;
  const duration = test.diagnostic()?.duration ?? 0;
  const icon = state === "passed" ? color("green", "✓") : color("red", "×");
  const time = ms(duration);
  const file = relative(root, test.module.moduleId);
  let name = `${file} > ${test.fullName}`;
  const width = process.stdout.columns;
  const room = width ? width - time.length - 5 : Infinity;
  if (name.length > room) name = `${name.slice(0, Math.max(room - 1, 10))}…`;
  const [path, ...rest] = name.split(" > ");
  const label = `${color("dim", `${path} >`)} ${rest.join(" > ")}`;
  const timeText = duration >= vitest.config.slowTestThreshold ? color("yellow", time) : color("dim", time);
  console.log(` ${icon} ${label} ${timeText}`);
  if (state === "failed") {
    for (const e of errors ?? []) console.log(color("red", `     ${e.message?.split("\n")[0]}`));
  }
}

const vitest = await createVitest(
  "test",
  { watch: false, reporters: [{ onTestCaseResult: printTest }] },
  {},
  { stdout: process.stdout, stderr: process.stderr },
);
const project = vitest.projects[0];

const groups = Object.entries(map.rf).map(([rf, tests]) => ({ rf, tests }));
const mappedFiles = new Set(groups.flatMap((g) => g.tests.map((t) => t.file)));
const mappedKeys = new Set(groups.flatMap((g) => g.tests.map((t) => key(t.file, t.test))));

// Archivos de test que el mapeo no conoce: se corren completos al final.
const newFiles = (await vitest.globTestSpecifications())
  .map((s) => relative(root, s.moduleId))
  .filter((f) => !mappedFiles.has(f));

const seen = new Set(); // todos los tests recolectados, hayan corrido o no
const ran = new Set();
const results = [];

async function runGroup(label, byFile) {
  console.log(color("bold", `\n=== ${label} ===`));
  const specs = [...byFile].map(([file, names]) =>
    project.createSpecification(
      join(root, file),
      names ? { testNamePattern: new RegExp(`^(?:${names.map(namePattern).join("|")})$`) } : undefined,
    ),
  );
  const started = performance.now();
  const { testModules, unhandledErrors } = await vitest.runTestSpecifications(specs);
  const elapsed = performance.now() - started;
  const current = new Set(specs.map((s) => s.moduleId));

  let passed = 0;
  let failed = 0;
  for (const mod of testModules) {
    if (!current.has(mod.moduleId)) continue;
    const file = relative(root, mod.moduleId);
    // Errores del archivo completo (import, beforeAll): no llegan como test.
    for (const e of mod.errors()) {
      failed++;
      console.log(` ${color("red", "×")} ${file} ${color("red", e.message ?? "")}`);
    }
    for (const test of mod.children.allTests()) {
      seen.add(key(file, test.fullName));
      const { state } = test.result();
      if (state === "skipped" || state === "pending") continue;
      ran.add(key(file, test.fullName));
      if (state === "passed") passed++;
      else failed++;
    }
  }
  for (const e of unhandledErrors) {
    failed++;
    console.log(color("red", ` × error no manejado: ${e?.message ?? e}`));
  }

  const summary = [color("green", `${passed} aprobados`)];
  if (failed) summary.push(color("red", `${failed} fallidos`));
  console.log(`   ${summary.join(color("dim", " | "))} ${color("dim", `(${ms(elapsed)})`)}`);
  results.push({ label, ok: failed === 0, passed, failed });
}

for (const { rf, tests } of groups) {
  if (!fullRun && !wanted.has(rf)) continue;
  const byFile = new Map();
  for (const t of tests) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t.test]);
  await runGroup(rf.startsWith("RF") ? `RF ${rf.slice(2)}` : rf, byFile);
}

if (fullRun) {
  // Tests recolectados en archivos mapeados que no están en el mapeo, más
  // archivos nuevos completos.
  const orphans = new Map();
  for (const k of seen) {
    if (mappedKeys.has(k) || ran.has(k)) continue;
    const [file, test] = k.split("\u0000");
    orphans.set(file, [...(orphans.get(file) ?? []), test]);
  }
  for (const f of newFiles) orphans.set(f, null);
  if (orphans.size) {
    for (const [file, tests] of orphans) {
      for (const t of tests ?? ["(archivo completo)"]) console.warn(`aviso: test sin RF en rf-map.json: ${file} :: ${t}`);
    }
    await runGroup("SIN RF", orphans);
  }
  for (const k of mappedKeys) {
    if (!seen.has(k)) console.warn(`aviso: rf-map.json apunta a un test que ya no existe: ${k.replace("\u0000", " :: ")}`);
  }
}

await vitest.close();

const bad = results.filter((r) => !r.ok);
const total = results.reduce((n, r) => n + r.passed, 0);
const totalFailed = results.reduce((n, r) => n + r.failed, 0);
console.log(
  `\n ${color("bold", "Grupos")}  ${results.length}` +
    `\n ${color("bold", "Pruebas")} ${color("green", `${total} aprobados`)}${totalFailed ? color("red", ` | ${totalFailed} fallidos`) : ""}` +
    (bad.length ? `\n ${color("bold", "Fallos")}  ${color("red", bad.map((r) => r.label).join(", "))}` : ""),
);
process.exit(bad.length ? 1 : 0);
