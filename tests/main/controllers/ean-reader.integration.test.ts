import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import { createEanReaderController } from "../../../src/main/controllers/ean-reader";
import { createProductQueryController, queryActiveProductsWithExecutor, queryProductDetailWithExecutor } from "../../../src/main/controllers/product-query";
import { authorizeUser } from "../../../src/main/controllers/auth-context";
import { registerAuditEvent } from "../../../src/main/controllers/audit-service";
import { createAuthTestDatabase, removeAuthTempDir, seedUser } from "../../../src/main/controllers/auth-fixtures";

let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>;
beforeAll(async () => {
  fixture = await createAuthTestDatabase();
  await seedUser(fixture.db, { usuarioId: "12345678-9", trabajadorId: 1, rut: "12345678-9" });
  await seedUser(fixture.db, { usuarioId: "23456789-0", trabajadorId: 2, rut: "23456789-0", rolBd: "trabajador" });
  await fixture.db.insert(schema.categoria).values({ categoriaId: 1, categoriaNombre: "Bebidas", categoriaExigeVencimiento: false });
  await fixture.db.insert(schema.producto).values({ productoEan13: "7802920000015", productoNombre: "Leche", productoPrecioVenta: 1000, categoriaId: 1 });
});
afterAll(async () => {
  fixture?.client.close();
  if (fixture) await removeAuthTempDir(fixture.dir);
});

function controller() {
  return createEanReaderController({
    findProduct: (ean13) => queryProductDetailWithExecutor(fixture.db, schema, ean13, false),
    report: (event) => registerAuditEvent(fixture.db, schema, event),
  });
}
function context(channel: string, rol: "dueno" | "trabajador", usuarioId: string) {
  return { channel, claims: { usuarioId, rol, usuarioRol: rol, passwordTemporal: false, sesionId: "session" } };
}

describe("C24 reutiliza C13 y C04 contra libSQL", () => {
  it("mantiene exacta la búsqueda de venta aunque el nombre de otro producto contenga el EAN escaneado", async () => {
    await fixture.db.insert(schema.producto).values({
      productoEan13: "5901234123457", productoNombre: "7802920000015", productoPrecioVenta: 900, categoriaId: 1,
    });
    const products = await queryActiveProductsWithExecutor(fixture.db, schema, { ean13: "7802920000015", limit: 1 });
    expect(products.map((product) => product.ean13)).toEqual(["7802920000015"]);
    const byName = await queryActiveProductsWithExecutor(fixture.db, schema, { query: "Lech", limit: 10 });
    expect(byName.map((product) => product.nombre)).toEqual(["Leche"]);
    const productQuery = createProductQueryController({
      authorize: (usuarioId, roles) => authorizeUser(fixture.db, schema, usuarioId, roles),
      listProducts: async () => [], listCategories: async () => [],
      findProduct: (ean13) => queryProductDetailWithExecutor(fixture.db, schema, ean13, false),
      listActiveProducts: (options) => queryActiveProductsWithExecutor(fixture.db, schema, options),
    });
    expect(await productQuery.handle({ ean13: "7802920000015", usuarioId: "12345678-9", limit: 1 },
      context("producto:buscar-activo", "dueno", "12345678-9")))
      .toMatchObject({ ok: true, data: [{ ean13: "7802920000015" }] });
  });
  it("busca el EAN exacto y no confunde nombres numéricos de producto con códigos", async () => {
    await fixture.db.insert(schema.producto).values({ productoEan13: "4006381333931", productoNombre: "7802345600012", productoPrecioVenta: 900, categoriaId: 1 });
    const ctx = context("ean:validar-captura", "trabajador", "23456789-0");
    expect(await controller().handle({ value: "7802920000015", mode: "buscar-producto" }, ctx))
      .toMatchObject({ ok: true, data: { producto: { nombre: "Leche", ean13: "7802920000015" } } });
    expect(await controller().handle({ value: "7802345600012", mode: "buscar-producto" }, ctx))
      .toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await controller().handle({ value: "7802345600012", mode: "validar" }, ctx))
      .toEqual({ ok: true, data: { ean13: "7802345600012" } });
  });

  it.each([ ["dueno", "12345678-9"], ["trabajador", "23456789-0"] ] as const)(
    "persiste un fallo con la identidad confiable de %s, rol, marca de tiempo y módulo", async (rol, usuarioId) => {
      const before = new Date();
      expect(await controller().handle({ modulo: "ventas", usuarioId: "spoofed", ean13: "inventado" }, context("ean:registrar-fallo", rol, usuarioId)))
        .toEqual({ ok: true, data: { registrado: true } });
      const rows = await fixture.db.all<{ usuarioId: string; rol: string; fecha: string; modulo: string; descripcion: string }>(sql`
        SELECT uv.usuario_id AS usuarioId, uv.usuario_version_rol AS rol,
          la.log_fecha_hora AS fecha, la.log_modulo AS modulo, la.log_descripcion AS descripcion
        FROM log_auditoria la JOIN usuario_version uv USING (usuario_version_id)
        WHERE uv.usuario_id = ${usuarioId} AND la.log_tipo_accion = 'lectura_fallida'
      `);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ usuarioId, rol, modulo: "ventas" });
      expect(new Date(rows[0].fecha).getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(rows[0].descripcion).not.toMatch(/inventado|spoofed|\d{13}/);
    },
  );
});
