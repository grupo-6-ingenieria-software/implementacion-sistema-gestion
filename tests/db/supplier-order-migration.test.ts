import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";

let client: Client | undefined;
let databaseDir: string | undefined;

afterEach(async () => {
  client?.close();
  client = undefined;
  if (databaseDir) await removeTempDir(databaseDir);
  databaseDir = undefined;
});

describe("supplier order migration", () => {
  it("preserves legacy orders and normalizes their state and received quantity", async () => {
    databaseDir = await mkdtemp(join(tmpdir(), "huascar-order-migration-"));
    client = createClient({
      url: `file:${join(databaseDir, "test.db").replace(/\\/g, "/")}`,
    });
    await client.execute("PRAGMA foreign_keys = ON");
    await applyMigration("0000_brave_proteus.sql");
    await applyMigration("0001_user_roles_dueno_trabajador.sql");
    await client.executeMultiple(`
      INSERT INTO trabajador
        (trabajador_id, trabajador_rut, trabajador_nombre, trabajador_apellido,
         trabajador_telefono, trabajador_fecha_ingreso, trabajador_estado)
      VALUES
        (1, '12345678-9', 'Maria', 'Huascar', '987654321', '2024-01-01', 'activo');
      INSERT INTO usuario
        (usuario_id, usuario_rol, usuario_fecha_creacion, trabajador_id)
      VALUES
        ('12345678-9', 'dueno', '2026-01-01T00:00:00.000Z', 1);
      INSERT INTO categoria
        (categoria_id, categoria_nombre, categoria_exige_vencimiento)
      VALUES
        (1, 'Lacteos', 1);
      INSERT INTO producto
        (producto_id, producto_ean_13, producto_nombre, producto_precio_venta,
         producto_stock_minimo, producto_estado, producto_fecha_registro, categoria_id)
      VALUES
        (1, '7802920000015', 'Leche', 1000, 2, 'activo', '2026-01-01', 1);
      INSERT INTO proveedor
        (proveedor_id, proveedor_rut, proveedor_nombre_razon_social,
         proveedor_nombre_contacto, proveedor_telefono, proveedor_correo_electronico)
      VALUES
        (1, '76543210-1', 'Distribuidora Central S.A.', 'Juan Perez',
         '912345678', 'ventas@distribuidora.cl');
      INSERT INTO pedido_proveedor
        (pedido_proveedor_id, pedido_proveedor_estado, proveedor_id, usuario_emisor_id)
      VALUES
        ('10000000-0000-4000-8000-000000000001', 'emitido', 1, '12345678-9');
      INSERT INTO detalle_pedido
        (detalle_pedido_id, pedido_proveedor_id, producto_id,
         cantidad_solicitada, cantidad_recibida)
      VALUES
        ('20000000-0000-4000-8000-000000000001',
         '10000000-0000-4000-8000-000000000001', 1, 10, NULL);
    `);

    await applyMigration("0002_supplier_orders.sql");

    const order = await client.execute(`
      SELECT
        pp.pedido_proveedor_estado AS estado,
        dp.cantidad_solicitada AS solicitada,
        dp.cantidad_recibida AS recibida
      FROM pedido_proveedor pp
      INNER JOIN detalle_pedido dp
        ON dp.pedido_proveedor_id = pp.pedido_proveedor_id
    `);
    const foreignKeyErrors = await client.execute("PRAGMA foreign_key_check");

    expect(order.rows).toHaveLength(1);
    expect(order.rows[0]).toMatchObject({
      estado: "pendiente",
      solicitada: 10,
      recibida: 0,
    });
    expect(foreignKeyErrors.rows).toHaveLength(0);
  });
});

async function applyMigration(fileName: string): Promise<void> {
  const contents = await readFile(
    join(process.cwd(), "drizzle/migrations", fileName),
    "utf8",
  );
  await client!.executeMultiple(contents);
}

async function removeTempDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
