import { mkdtemp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import bcrypt from "bcryptjs";
import * as schema from "../src/db/schema";
import { initializeDatabase } from "../src/db/init";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "out");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(resolve(output, "demo-"));
const databasePath = resolve(directory, "demo.db");
const client = createClient({ url: `file:${databasePath}` });
const db = drizzle(client, { schema });
try {
  await client.execute("PRAGMA foreign_keys = ON");
  await initializeDatabase(db, client, {
    migrationsFolder: resolve(root, "drizzle/migrations"),
    triggersPath: resolve(root, "src/db/triggers.sql"),
  });
  await db.transaction(async (tx) => {
    await tx.insert(schema.trabajador).values({
      trabajadorId: 1, trabajadorRut: "12345678-9",
      trabajadorNombre: "María", trabajadorApellido: "Huáscar",
      trabajadorTelefono: "987654321", trabajadorFechaIngreso: "2024-01-01",
      trabajadorEstado: "activo",
    });
    await tx.insert(schema.usuario).values({ usuarioId: "12345678-9", usuarioRol: "dueno", trabajadorId: 1 });
    await tx.insert(schema.contrasena).values({ contrasenaHash: await bcrypt.hash("Huascar2026", 10), usuarioId: "12345678-9", generadaPorUsuarioId: "12345678-9" });
    await tx.insert(schema.categoria).values({ categoriaId: 1, categoriaNombre: "Abarrotes", categoriaExigeVencimiento: false });
    await tx.insert(schema.producto).values([
      { productoId: 1, productoEan13: "7802920000015", productoNombre: "Arroz grano largo 1 kg", productoPrecioVenta: 1500, productoStockMinimo: 0, productoEstado: "activo", categoriaId: 1 },
      { productoId: 2, productoEan13: "7802920000022", productoNombre: "Galletas de vainilla 150 g", productoPrecioVenta: 1000, productoStockMinimo: 0, productoEstado: "activo", categoriaId: 1 },
    ]);
    await tx.insert(schema.historialPrecioProducto).values([
      { productoId: 1, historialPrecioVenta: 1500, historialPrecioCosto: 900 },
      { productoId: 2, historialPrecioVenta: 1000, historialPrecioCosto: 600 },
    ]);
    await tx.insert(schema.proveedor).values({ proveedorId: 1, proveedorRut: "76543210-3", proveedorNombreRazonSocial: "Distribuidora Los Robles SpA", proveedorNombreContacto: "Carlos Muñoz", proveedorTelefono: "912345678", proveedorCorreoElectronico: "pedidos@distribuidoralosrobles.cl" });
    await tx.insert(schema.proveedorCategoria).values({ proveedorId: 1, categoriaId: 1 });
    await tx.insert(schema.pedidoProveedor).values({ pedidoProveedorId: "18000000-0000-4000-8000-000000000001", proveedorId: 1, usuarioEmisorId: "12345678-9", pedidoProveedorEstado: "pendiente" });
    await tx.insert(schema.detallePedido).values([
      { pedidoProveedorId: "18000000-0000-4000-8000-000000000001", productoId: 1, cantidadSolicitada: 10 },
      { pedidoProveedorId: "18000000-0000-4000-8000-000000000001", productoId: 2, cantidadSolicitada: 5 },
    ]);
  });
} finally {
  client.close();
}

const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: `file:${databasePath}`,
  DATABASE_AUTH_TOKEN: "",
  HUASCAR_DEMO: "1",
  HUASCAR_DEBUG_LOGIN: "0",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = spawn(process.execPath, [
  resolve(root, "node_modules/electron-vite/bin/electron-vite.js"),
  "dev", "--outDir", resolve(directory, "app"),
  "--entry", resolve(directory, "app/main/index.js"),
  ...process.argv.slice(2),
], { cwd: root, env, stdio: "inherit" });
app.on("error", (error) => { console.error(error); process.exitCode = 1; });
app.on("exit", (code) => { process.exitCode = code ?? 0; });
process.on("SIGINT", () => app.kill("SIGINT"));
process.on("SIGTERM", () => app.kill("SIGTERM"));
