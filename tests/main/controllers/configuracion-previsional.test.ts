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

describe("configuracion previsional service", () => {
  it("initializes the RF35 default rates on first read", async () => {
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

  it("rejects actors without an authenticated owner session", async () => {
    await expect(
      getPrevisionalRates(testDb!.db as unknown as DbExecutor, {
        role: "dueno",
        usuarioId: "",
      }),
    ).rejects.toBeInstanceOf(PrevisionalAccessError);
  });

  it("closes the previous vigencia and keeps only the changed rate current", async () => {
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

  it("does not create a new vigencia when nothing changed", async () => {
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

  it("returns FORBIDDEN through the IPC channel for non-owner sessions", async () => {
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

  it("returns VALIDATION_ERROR for out-of-range percentages", async () => {
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

  it("rejects unknown channels", async () => {
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
