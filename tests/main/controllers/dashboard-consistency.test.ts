import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";
import * as schema from "../../../src/db/schema";
import {
  loadDashboardData,
  dashboardOperations,
} from "../../../src/main/controllers/dashboard-service";
import { loadAttendanceIndicator } from "../../../src/main/controllers/attendance-summary";
import type { DashboardDb } from "../../../src/main/controllers/dashboard-queries";
import { getAttendanceDisplay } from "../../../src/renderer/src/views/DashboardView";

const NOW = new Date("2026-09-08T16:00:00Z");
let fixture: AuthTestDatabase;
beforeEach(async () => {
  fixture = await createAuthTestDatabase();
  await seedUser(fixture.db, {
    usuarioId: "11111111-1",
    trabajadorId: 1,
    rut: "11111111-1",
    nombre: "Ana",
  });
  await seedUser(fixture.db, {
    usuarioId: "22222222-2",
    trabajadorId: 2,
    rut: "22222222-2",
    rolBd: "trabajador",
    nombre: "Luis",
  });
  await fixture.db
    .insert(schema.asistencia)
    .values({ trabajadorId: 1, asistenciaFechaHoraEntrada: NOW.toISOString() });
});
afterEach(async () => {
  fixture.client.close();
  await removeAuthTempDir(fixture.dir);
});

describe("CU55 integration", () => {
  it("returns only the authenticated worker, while the owner sees the global summary", async () => {
    const database = fixture.db as unknown as DashboardDb;
    const own = await loadAttendanceIndicator(
      database,
      { role: "trabajador", usuarioId: "22222222-2" },
      NOW,
    );
    expect(own).toMatchObject({ scope: "own", workerId: 2, enteredAt: null });
    expect(own).not.toHaveProperty("pendingWorkers");
    expect(JSON.stringify(own)).not.toContain("Ana");
    expect(getAttendanceDisplay(own)).toMatchObject({
      title: "Mi asistencia de hoy",
      alert: true,
    });
    expect(
      await loadAttendanceIndicator(database, { role: "dueno" }, NOW),
    ).toMatchObject({
      scope: "global",
      activeWorkers: 2,
      workersWithAttendance: 1,
      workersWithoutAttendance: 1,
    });
  });
  it("delegates C07 → C08 → C09 → C23 and stops at the first failure", async () => {
    const sequence: string[] = [];
    const operations: typeof dashboardOperations = {
      stock: async (database) => {
        sequence.push("stock");
        return dashboardOperations.stock(database);
      },
      expiration: async (database, now) => {
        sequence.push("expiration");
        return dashboardOperations.expiration(database, now);
      },
      sales: async (database, now) => {
        sequence.push("sales");
        return dashboardOperations.sales(database, now);
      },
      attendance: async (database, request, now) => {
        sequence.push("attendance");
        return dashboardOperations.attendance(database, request, now);
      },
    };
    await loadDashboardData(
      fixture.db as unknown as DashboardDb,
      { role: "dueno" },
      NOW,
      operations,
    );
    expect(sequence).toEqual(["stock", "expiration", "sales", "attendance"]);
    sequence.length = 0;
    operations.stock = async () => {
      sequence.push("stock");
      throw new Error("datos no disponibles");
    };
    await expect(
      loadDashboardData(
        fixture.db as unknown as DashboardDb,
        { role: "dueno" },
        NOW,
        operations,
      ),
    ).rejects.toThrow("datos no disponibles");
    expect(sequence).toEqual(["stock"]);
  });
});
