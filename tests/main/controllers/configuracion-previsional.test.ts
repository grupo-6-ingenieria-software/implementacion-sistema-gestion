import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";
import {
  PrevisionalAccessError,
  configPrevisionalController,
  ensureVigentTasas,
  getPrevisionalRates,
  updatePrevisionalRates,
} from "../../../src/main/controllers/configuracion-previsional";
import type { DbExecutor } from "../../../src/main/controllers/sale-service";

let testDb: AuthTestDatabase | undefined;
const ownerActor = { role: "dueno" as const, usuarioId: "11111111-1" };

beforeEach(async () => {
  testDb = await createAuthTestDatabase();
  await seedUser(testDb.db, {
    usuarioId: "11111111-1",
    trabajadorId: 1,
    rut: "11111111-1",
    rolBd: "dueno",
    conContrasena: false,
  });
  await seedUser(testDb.db, {
    usuarioId: "22222222-2",
    trabajadorId: 2,
    rut: "22222222-2",
    rolBd: "trabajador",
    conContrasena: false,
  });
});

afterEach(async () => {
  if (!testDb) {
    return;
  }

  testDb.client.close();
  await removeAuthTempDir(testDb.dir);
  testDb = undefined;
});

describe("servicio de configuración previsional", () => {
  it("inicializa las tasas por defecto de RF35 en la primera lectura", async () => {
    const rates = await getPrevisionalRates(
      testDb!.db as unknown as DbExecutor,
      ownerActor,
    );

    expect(rates).toEqual({ afp: 11.5, salud: 7, cesantia: 0.6 });

    const rows = await testDb!.db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count FROM tasa_legal
      WHERE tasa_legal_fecha_vigencia_hasta IS NULL
    `);

    expect(rows[0]?.count).toBe(3);
  });

  it("rechaza actores sin sesión autenticada de dueño", async () => {
    await expect(
      getPrevisionalRates(testDb!.db as unknown as DbExecutor, {
        role: "dueno",
        usuarioId: "",
      }),
    ).rejects.toBeInstanceOf(PrevisionalAccessError);
  });

  it("cierra la vigencia anterior y mantiene vigente solo la tasa modificada", async () => {
    await ensureVigentTasas(testDb!.db as unknown as DbExecutor);

    const updated = await updatePrevisionalRates(
      testDb!.db as unknown as DbExecutor,
      { afp: 12.5, salud: 7, cesantia: 0.6 },
      ownerActor,
    );

    expect(updated).toEqual({ afp: 12.5, salud: 7, cesantia: 0.6 });

    const afpRows = await testDb!.db.all<{
      valor: number;
      vigenciaHasta: string | null;
    }>(sql`
      SELECT tasa_legal_valor AS valor, tasa_legal_fecha_vigencia_hasta AS vigenciaHasta
      FROM tasa_legal
      WHERE tasa_legal_tipo = 'afp'
      ORDER BY tasa_legal_id
    `);

    expect(afpRows).toHaveLength(2);
    expect(afpRows[0]).toMatchObject({ valor: 11.5 });
    expect(afpRows[0]?.vigenciaHasta).not.toBeNull();
    expect(afpRows[1]).toMatchObject({ valor: 12.5, vigenciaHasta: null });

    const auditRows = await testDb!.db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count FROM log_auditoria
      WHERE log_tipo_accion = 'configurar_previsional'
    `);

    expect(auditRows[0]?.count).toBe(1);
  });

  it("no crea una nueva vigencia cuando no hay cambios", async () => {
    await ensureVigentTasas(testDb!.db as unknown as DbExecutor);

    await updatePrevisionalRates(
      testDb!.db as unknown as DbExecutor,
      { afp: 11.5, salud: 7, cesantia: 0.6 },
      ownerActor,
    );

    const rows = await testDb!.db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count FROM tasa_legal
    `);

    expect(rows[0]?.count).toBe(3);
  });

  it("devuelve FORBIDDEN por el canal IPC para sesiones que no son de dueño", async () => {
    const response = await configPrevisionalController.handle(
      { usuarioId: "22222222-2" },
      { channel: "configuracion:previsional-obtener" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected forbidden response");
    }

    expect(response.error.code).toBe("FORBIDDEN");
  });

  it("devuelve VALIDATION_ERROR para porcentajes fuera de rango", async () => {
    const response = await configPrevisionalController.handle(
      { usuarioId: "11111111-1", afp: 150, salud: 7, cesantia: -1 },
      { channel: "configuracion:previsional-actualizar" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected validation error");
    }

    expect(response.error.code).toBe("VALIDATION_ERROR");
    expect(response.error.fieldErrors?.afp).toBeDefined();
    expect(response.error.fieldErrors?.cesantia).toBeDefined();
  });

  it("rechaza canales desconocidos", async () => {
    const response = await configPrevisionalController.handle(
      { usuarioId: "11111111-1" },
      { channel: "configuracion:otro" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected invalid channel response");
    }

    expect(response.error.code).toBe("INVALID_CHANNEL");
  });
});
