import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";
import { updatePrevisionalRates } from "../../../src/main/controllers/configuracion-previsional";
import {
  RemuneracionBusinessError,
  RemuneracionValidationError,
  registerRemuneracion,
  remuneracionController,
} from "../../../src/main/controllers/remuneracion";
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
    estado: "activo",
  });
  await seedUser(testDb.db, {
    usuarioId: "33333333-3",
    trabajadorId: 3,
    rut: "33333333-3",
    rolBd: "trabajador",
    conContrasena: false,
    estado: "inactivo",
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

describe("remuneracion service", () => {
  it("registers a remuneracion for an active worker with RF34 default rates", async () => {
    const result = await registerRemuneracion(
      testDb!.db as unknown as DbExecutor,
      { trabajadorId: 2, mes: 6, anio: 2026, montoBruto: 500000 },
      ownerActor,
    );

    expect(result.descuentos).toEqual([
      { tipo: "afp", porcentaje: 11.5, monto: 57500 },
      { tipo: "salud", porcentaje: 7, monto: 35000 },
      { tipo: "cesantia", porcentaje: 0.6, monto: 3000 },
    ]);
    expect(result.montoLiquido).toBe(404500);

    const rows = await testDb!.db.all<{
      bruto: number;
      tasas: number;
      auditoria: number;
    }>(sql`
      SELECT
        r.remuneracion_monto_bruto AS bruto,
        (SELECT COUNT(*) FROM remuneracion_tasa WHERE remuneracion_id = r.remuneracion_id) AS tasas,
        (SELECT COUNT(*) FROM log_auditoria WHERE log_tipo_accion = 'registrar_remuneracion') AS auditoria
      FROM remuneracion r
      WHERE r.remuneracion_id = ${result.remuneracionId}
    `);

    expect(rows[0]).toMatchObject({ bruto: 500000, tasas: 3, auditoria: 1 });
  });

  it("rejects a duplicate trabajador/periodo", async () => {
    await registerRemuneracion(
      testDb!.db as unknown as DbExecutor,
      { trabajadorId: 2, mes: 6, anio: 2026, montoBruto: 500000 },
      ownerActor,
    );

    await expect(
      registerRemuneracion(
        testDb!.db as unknown as DbExecutor,
        { trabajadorId: 2, mes: 6, anio: 2026, montoBruto: 400000 },
        ownerActor,
      ),
    ).rejects.toBeInstanceOf(RemuneracionBusinessError);
  });

  it("rejects inactive workers without activity in the period", async () => {
    await expect(
      registerRemuneracion(
        testDb!.db as unknown as DbExecutor,
        { trabajadorId: 3, mes: 6, anio: 2026, montoBruto: 500000 },
        ownerActor,
      ),
    ).rejects.toBeInstanceOf(RemuneracionValidationError);
  });

  it("accepts inactive workers with shift activity in the period", async () => {
    await testDb!.db.run(sql`
      INSERT INTO turno (
        turno_id, turno_fecha_hora_inicio, turno_fecha_hora_fin,
        turno_estado, trabajador_id
      )
      VALUES (
        ${randomUUID()}, '2026-06-10T12:00:00.000Z', '2026-06-10T20:00:00.000Z',
        'completado', 3
      )
    `);

    const result = await registerRemuneracion(
      testDb!.db as unknown as DbExecutor,
      { trabajadorId: 3, mes: 6, anio: 2026, montoBruto: 300000 },
      ownerActor,
    );

    expect(result.remuneracionId).toBeDefined();
  });

  it("rejects non-owner sessions through the IPC channel", async () => {
    const response = await remuneracionController.handle(
      {
        usuarioId: "22222222-2",
        trabajadorId: 2,
        mes: 6,
        anio: 2026,
        montoBruto: 500000,
      },
      { channel: "remuneracion:registrar" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected forbidden response");
    }

    expect(response.error.code).toBe("FORBIDDEN");
  });

  it("rejects a non positive gross amount", async () => {
    const response = await remuneracionController.handle(
      {
        usuarioId: "11111111-1",
        trabajadorId: 2,
        mes: 6,
        anio: 2026,
        montoBruto: 0,
      },
      { channel: "remuneracion:registrar" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected validation error");
    }

    expect(response.error.code).toBe("VALIDATION_ERROR");
    expect(response.error.fieldErrors?.montoBruto).toBeDefined();
  });

  it("keeps historical remuneracion_tasa unchanged after the rate is updated later", async () => {
    const first = await registerRemuneracion(
      testDb!.db as unknown as DbExecutor,
      { trabajadorId: 2, mes: 6, anio: 2026, montoBruto: 500000 },
      ownerActor,
    );

    expect(first.descuentos.find((d) => d.tipo === "afp")?.monto).toBe(57500);

    await updatePrevisionalRates(
      testDb!.db as unknown as DbExecutor,
      { afp: 20, salud: 7, cesantia: 0.6 },
      ownerActor,
    );

    const historicalAfp = await testDb!.db.all<{ valor: number }>(sql`
      SELECT tl.tasa_legal_valor AS valor
      FROM remuneracion_tasa rt
      INNER JOIN tasa_legal tl ON tl.tasa_legal_id = rt.tasa_legal_id
      WHERE rt.remuneracion_id = ${first.remuneracionId}
        AND tl.tasa_legal_tipo = 'afp'
    `);

    expect(historicalAfp[0]?.valor).toBe(11.5);

    const second = await registerRemuneracion(
      testDb!.db as unknown as DbExecutor,
      { trabajadorId: 2, mes: 7, anio: 2026, montoBruto: 500000 },
      ownerActor,
    );

    expect(second.descuentos.find((d) => d.tipo === "afp")?.monto).toBe(
      100000,
    );
  });

  it("rejects unknown channels", async () => {
    const response = await remuneracionController.handle(
      { usuarioId: "11111111-1" },
      { channel: "remuneracion:otro" },
    );

    expect(response.ok).toBe(false);
    if (response.ok) {
      throw new Error("Expected invalid channel response");
    }

    expect(response.error.code).toBe("INVALID_CHANNEL");
  });
});
