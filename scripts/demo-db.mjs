import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";

try {
  const session = JSON.parse(await readFile(new URL("../out/demo-current.json", import.meta.url), "utf8"));
  if (!Number.isInteger(session.pid) || session.pid <= 0) throw new Error("Sesión inválida");
  process.kill(session.pid, 0);
  await stat(session.databasePath);
  console.log(`SQLite de la sesión activa: ${session.databasePath}`);
  // query_only protege los datos y permite abrir los auxiliares WAL de SQLite.
  const sqlite = spawn("sqlite3", ["-header", "-column", "-cmd", "PRAGMA query_only=ON;", session.databasePath, ...process.argv.slice(2)], { stdio: "inherit" });
  sqlite.on("error", (error) => { console.error(`No se pudo abrir sqlite3: ${error.message}`); process.exitCode = 1; });
  sqlite.on("exit", (code) => { process.exitCode = code ?? 1; });
} catch {
  console.error("No hay una sesión de demo registrada y activa. Inicia npm run demo y vuelve a ejecutar npm run demo:db.");
  process.exitCode = 1;
}
