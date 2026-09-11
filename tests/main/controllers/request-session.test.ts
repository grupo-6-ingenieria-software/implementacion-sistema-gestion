import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";
import {
  authorizeRequest,
  guardChannel,
} from "../../../src/main/controllers/auth-guard";
import { validateAndRefreshActiveSession } from "../../../src/main/controllers/session";
import { signSessionToken } from "../../../src/main/controllers/auth-jwt";

const NOW = new Date("2026-09-08T12:00:00Z");
const SESSION = "123e4567-e89b-42d3-a456-556642440000";
const USER = "11111111-1";
let fixture: AuthTestDatabase;
beforeEach(async () => {
  fixture = await createAuthTestDatabase();
  await seedUser(fixture.db, { usuarioId: USER, trabajadorId: 1, rut: USER });
});
afterEach(async () => {
  fixture.client.close();
  await removeAuthTempDir(fixture.dir);
});

async function seedSession(minutes: number, closed = false) {
  await fixture.db.insert(schema.sesionUsuario).values({
    sesionUsuarioId: SESSION,
    usuarioId: USER,
    sesionFechaHoraInicio: new Date(NOW.getTime() - 60 * 60000).toISOString(),
    sesionFechaHoraUltimoAcceso: new Date(
      NOW.getTime() - minutes * 60000,
    ).toISOString(),
    sesionFechaHoraCierre: closed ? NOW.toISOString() : null,
    sesionMotivoCierre: closed ? "manual" : null,
  });
}
function request(channel = "producto:listar", expired = vi.fn()) {
  const token = signSessionToken({
    usuarioId: USER,
    rol: "dueno",
    usuarioRol: "dueno",
    passwordTemporal: false,
    sesionId: SESSION,
  });
  return authorizeRequest(channel, { __authToken: token }, expired, {
    identity: guardChannel,
    session: (claims, refresh) =>
      validateAndRefreshActiveSession(
        fixture.db,
        schema,
        claims.sesionId,
        claims.usuarioId,
        refresh,
        { now: () => NOW },
      ),
  });
}
describe("C03 → C05 before dispatch", () => {
  it.each([
    "producto:listar",
    "venta:registrar",
    "asistencia:entrada",
    "trabajador:registrar",
  ])(
    "rejects missing persisted sessions for %s despite a signed JWT",
    async (channel) => {
      expect((await request(channel)).ok).toBe(false);
    },
  );
  it("rejects closed sessions without renewing them", async () => {
    await seedSession(1, true);
    expect((await request()).ok).toBe(false);
    const [row] = await fixture.db.select().from(schema.sesionUsuario);
    expect(row.sesionFechaHoraUltimoAcceso).toBe("2026-09-08T11:59:00.000Z");
  });
  it("expires exactly at 30 minutes and sends the event", async () => {
    await seedSession(30);
    let persistedAtEvent: Promise<Array<{ motivo: string | null }>> | undefined;
    const expired = vi.fn(() => {
      persistedAtEvent = fixture.db.all<{ motivo: string | null }>(sql`
        SELECT sesion_motivo_cierre AS motivo
        FROM sesion_usuario
        WHERE sesion_usuario_id = ${SESSION}
      `);
    });
    expect((await request("producto:listar", expired)).ok).toBe(false);
    expect(expired).toHaveBeenCalledOnce();
    expect(await persistedAtEvent).toEqual([{ motivo: "inactividad" }]);
    const [row] = await fixture.db.select().from(schema.sesionUsuario);
    expect(row.sesionMotivoCierre).toBe("inactividad");
    expect(row.sesionFechaHoraUltimoAcceso).toBe("2026-09-08T11:30:00.000Z");
  });
  it("preserves millisecond precision at the inactivity boundary and renews the valid action", async () => {
    await fixture.db.insert(schema.sesionUsuario).values({
      sesionUsuarioId: SESSION,
      usuarioId: USER,
      sesionFechaHoraInicio: new Date(NOW.getTime() - 60 * 60000).toISOString(),
      sesionFechaHoraUltimoAcceso: new Date(
        NOW.getTime() - 30 * 60000 + 1,
      ).toISOString(),
    });

    expect((await request()).ok).toBe(true);
    let [row] = await fixture.db.select().from(schema.sesionUsuario);
    expect(row.sesionFechaHoraUltimoAcceso).toBe(NOW.toISOString());
    expect(row.sesionFechaHoraCierre).toBeNull();

    await fixture.db.delete(schema.sesionUsuario);
    await seedSession(30);
    const expired = vi.fn();
    expect((await request("producto:listar", expired)).ok).toBe(false);
    [row] = await fixture.db.select().from(schema.sesionUsuario);
    expect(row.sesionMotivoCierre).toBe("inactividad");
    expect(expired).toHaveBeenCalledOnce();
  });
  it("fails closed without reporting inactivity when ultimo acceso is malformed", async () => {
    await seedSession(1);
    await fixture.db.update(schema.sesionUsuario).set({
      sesionFechaHoraUltimoAcceso: "fecha-invalida",
    });

    const expired = vi.fn();
    expect((await request("producto:listar", expired)).ok).toBe(false);
    const [row] = await fixture.db.select().from(schema.sesionUsuario);
    expect(row.sesionMotivoCierre).toBeNull();
    expect(expired).not.toHaveBeenCalled();
  });
  it("accepts and renews a valid SQLite default timestamp without milliseconds", async () => {
    await seedSession(1);
    await fixture.db.update(schema.sesionUsuario).set({
      sesionFechaHoraUltimoAcceso: "2026-09-08 11:59:00",
    });

    expect((await request()).ok).toBe(true);
    const [row] = await fixture.db.select().from(schema.sesionUsuario);
    expect(row.sesionFechaHoraUltimoAcceso).toBe(NOW.toISOString());
    expect(row.sesionFechaHoraCierre).toBeNull();
  });
  it("checks without renewing a heartbeat, then renews real activity", async () => {
    await seedSession(29);
    expect((await request("auth:verificar-sesion")).ok).toBe(true);
    let [row] = await fixture.db.select().from(schema.sesionUsuario);
    expect(row.sesionFechaHoraUltimoAcceso).toBe("2026-09-08T11:31:00.000Z");
    expect((await request()).ok).toBe(true);
    [row] = await fixture.db.select().from(schema.sesionUsuario);
    expect(row.sesionFechaHoraUltimoAcceso).toBe(NOW.toISOString());
  });
  it("fails closed when session persistence fails", async () => {
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await fixture.db.run(sql`DROP TABLE sesion_usuario`);
    const expired = vi.fn();
    const result = await request("producto:listar", expired);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.response).toMatchObject({
        error: { code: "TECHNICAL_ERROR" },
      });
    expect(expired).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
