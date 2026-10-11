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
  listEligibleWorkers,
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

describe("servicio de remuneracion", () => {
  it("registra una remuneracion para un trabajador activo con tasas por defecto de RF34", async () => {
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

  it("rechaza un trabajador/periodo duplicado", async () => {
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

  it("rechaza trabajadores inactivos sin actividad en el periodo", async () => {
    await expect(
      registerRemuneracion(
        testDb!.db as unknown as DbExecutor,
        { trabajadorId: 3, mes: 6, anio: 2026, montoBruto: 500000 },
        ownerActor,
      ),
    ).rejects.toBeInstanceOf(RemuneracionValidationError);
  });

  it("acepta trabajadores inactivos con actividad de turnos en el periodo", async () => {
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

  describe("listEligibleWorkers", () => {
    it("lista un trabajador inactivo solo para el mes/año en que tuvo un turno", async () => {
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

      const juneRuts = (
        await listEligibleWorkers(testDb!.db as unknown as DbExecutor, {
          mes: 6,
          anio: 2026,
        })
      ).map((worker) => worker.rut);

      expect(juneRuts).toContain("33333333-3");

      const julyRuts = (
        await listEligibleWorkers(testDb!.db as unknown as DbExecutor, {
          mes: 7,
          anio: 2026,
        })
      ).map((worker) => worker.rut);

      expect(julyRuts).not.toContain("33333333-3");
    });

    it("siempre lista trabajadores activos sin importar el periodo", async () => {
      const rows = await listEligibleWorkers(
        testDb!.db as unknown as DbExecutor,
        { mes: 1, anio: 2020 },
      );

      expect(rows.map((worker) => worker.rut)).toContain("22222222-2");
    });

    it("nunca lista un trabajador inactivo sin actividad alguna", async () => {
      const rows = await listEligibleWorkers(
        testDb!.db as unknown as DbExecutor,
        { mes: 6, anio: 2026 },
      );

      expect(rows.map((worker) => worker.rut)).not.toContain("33333333-3");
    });

    it("rechaza sesiones que no son de rol dueno a través del canal IPC", async () => {
      const response = await remuneracionController.handle(
        { usuarioId: "22222222-2", mes: 6, anio: 2026 },
        { channel: "remuneracion:trabajadores-elegibles" },
      );

      expect(response.ok).toBe(false);
      if (response.ok) {
        throw new Error("Expected forbidden response");
      }

      expect(response.error.code).toBe("FORBIDDEN");
    });
  });

  it("rechaza sesiones que no son de rol dueno a través del canal IPC", async () => {
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

  it("rechaza un monto bruto no positivo", async () => {
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

  it("mantiene sin cambios la remuneracion_tasa histórica después de actualizar la tasa", async () => {
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

  it("rechaza canales desconocidos", async () => {
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
