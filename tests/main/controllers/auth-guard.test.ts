import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  CHANNEL_ROLES,
  PUBLIC_CHANNELS,
  authorizeRequest,
  guardChannel,
  type GuardDeps,
  type RequestAuthorizationDeps,
} from "../../../src/main/controllers/auth-guard";
import { registerAuditLog } from "../../../src/main/controllers/auth-context";
import { signSessionToken } from "../../../src/main/controllers/auth-jwt";
import { SESSION_INVALIDATED_MESSAGE } from "../../../src/shared/auth";
import type { SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";
import {
  createAuthTestDatabase,
  removeAuthTempDir,
  seedUser,
  type AuthTestDatabase,
} from "../../../src/main/controllers/auth-fixtures";

function claimsFor(rol: "dueno" | "trabajador"): SessionTokenClaims {
  return {
    usuarioId: "trusted-id",
    rol,
    usuarioRol: rol,
    passwordTemporal: false,
    sesionId: "00000000-0000-4000-8000-000000000777",
  };
}

function deps(overrides: Partial<GuardDeps>): GuardDeps {
  return {
    verifyToken: () => null,
    audit: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("guardChannel (RF56/CU57)", () => {
  it("permite el único canal público sin token", async () => {
    expect(PUBLIC_CHANNELS.has("auth:login")).toBe(true);

    const result = await guardChannel("auth:login", { usuario: "x" }, deps({}));

    expect(result.ok).toBe(true);
  });

  it("rechaza un canal sensible con token ausente o inválido (FORBIDDEN)", async () => {
    const result = await guardChannel(
      "producto:registrar",
      { usuarioId: "spoofed", __authToken: "garbage" },
      deps({ verifyToken: () => null }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.ok).toBe(false);
      if (!result.response.ok) {
        expect(result.response.error.code).toBe("FORBIDDEN");
      }
    }
  });

  it("deniega un token con rol incorrecto en un canal solo para dueno y lo registra en auditoría", async () => {
    const audit = vi.fn(async () => undefined);

    const result = await guardChannel(
      "producto:registrar",
      { usuarioId: "spoofed", __authToken: "t" },
      deps({ verifyToken: () => claimsFor("trabajador"), audit }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok && !result.response.ok) {
      expect(result.response.error.code).toBe("FORBIDDEN");
    }
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoAccion: "acceso_denegado",
        usuarioId: "trusted-id",
      }),
    );
  });

  it("sobrescribe un usuarioId falsificado con la identidad de confianza del claim", async () => {
    const result = await guardChannel(
      "producto:registrar",
      { usuarioId: "spoofed-attacker", nombre: "x", __authToken: "t" },
      deps({ verifyToken: () => claimsFor("dueno") }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.payload as { usuarioId: string; nombre: string };
      expect(payload.usuarioId).toBe("trusted-id");
      expect(payload.nombre).toBe("x");
      expect(result.context.claims?.usuarioId).toBe("trusted-id");
    }
  });

  it("permite un canal solo para autenticados con cualquier rol válido", async () => {
    const result = await guardChannel(
      "auditoria:registrar",
      { __authToken: "t" },
      deps({ verifyToken: () => claimsFor("trabajador") }),
    );

    expect(result.ok).toBe(true);
    expect(CHANNEL_ROLES.has("auditoria:registrar")).toBe(false);
  });

  it("deriva la restricción solo para dueno desde el árbol de navegación", () => {
    expect(CHANNEL_ROLES.get("producto:registrar")).toEqual(new Set(["dueno"]));
    expect(CHANNEL_ROLES.get("venta:registrar")).toEqual(
      new Set(["dueno", "trabajador"]),
    );
  });

  it("permite ambos roles en cada canal CU38/CU41 y confía solo en la identidad del JWT", async () => {
    for (const channel of ["venta:buscar", "venta:detalle", "venta:anular"]) {
      expect(CHANNEL_ROLES.get(channel)).toEqual(
        new Set(["dueno", "trabajador"]),
      );
      const result = await guardChannel(
        channel,
        { usuarioId: "spoofed", __authToken: "t" },
        deps({ verifyToken: () => claimsFor("trabajador") }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.payload as { usuarioId: string }).usuarioId).toBe(
          "trusted-id",
        );
      }
    }
  });

  it("permite a ambos roles cargar los canales del dashboard CU44", async () => {
    for (const channel of [
      "dashboard:cargar",
      "dashboard:total-ventas-dia",
    ]) {
      expect(CHANNEL_ROLES.get(channel)).toEqual(
        new Set(["dueno", "trabajador"]),
      );

      for (const role of ["dueno", "trabajador"] as const) {
        const result = await guardChannel(
          channel,
          { usuarioId: "spoofed", __authToken: "t" },
          deps({ verifyToken: () => claimsFor(role) }),
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect((result.payload as { usuarioId: string }).usuarioId).toBe(
            "trusted-id",
          );
        }
      }
    }
  });

  it("permite a trabajador listar trabajadores activos para Asistencia (sobrescritura entre módulos)", async () => {
    expect(CHANNEL_ROLES.get("trabajador:listar-activos")).toEqual(
      new Set(["dueno", "trabajador"]),
    );

    const result = await guardChannel(
      "trabajador:listar-activos",
      { __authToken: "t" },
      deps({ verifyToken: () => claimsFor("trabajador") }),
    );

    expect(result.ok).toBe(true);
  });

  it("abre la consulta de trabajadores a ambos roles y mantiene las mutaciones solo para dueno", () => {
    expect(CHANNEL_ROLES.get("trabajador:listar")).toEqual(
      new Set(["dueno", "trabajador"]),
    );
    expect(CHANNEL_ROLES.get("trabajador:registrar")).toEqual(
      new Set(["dueno"]),
    );
    expect(CHANNEL_ROLES.get("trabajador:actualizar")).toEqual(
      new Set(["dueno"]),
    );
    expect(CHANNEL_ROLES.get("trabajador:cambiar-estado")).toEqual(
      new Set(["dueno"]),
    );
  });
});

describe("authorizeRequest con rol efectivo de sesión (CU57, D1/D2)", () => {
  let testDb: AuthTestDatabase | undefined;

  beforeEach(async () => {
    testDb = await createAuthTestDatabase();
  });

  afterEach(async () => {
    if (!testDb) {
      return;
    }
    testDb.client.close();
    await removeAuthTempDir(testDb.dir);
    testDb = undefined;
  });

  function depsForSession(
    rolEfectivo: "dueno" | "trabajador" | undefined,
    audit: GuardDeps["audit"],
  ): RequestAuthorizationDeps {
    return {
      identity: guardChannel,
      session: async () =>
        rolEfectivo ? { active: true, rolEfectivo } : { active: true },
      audit,
    };
  }

  it("prefiere el rol de sesión sobre el rol del JWT y sobre el de la base de datos", async () => {
    // Cuenta dueno en la BD y JWT dueno, pero la sesión quedó congelada como
    // trabajador: el permiso se niega con el rol de la sesión.
    await seedUser(testDb!.db, {
      usuarioId: "trusted-id",
      trabajadorId: 1,
      rut: "12345678-9",
      rolBd: "dueno",
    });

    const audit = vi.fn(async () => undefined);
    const token = signSessionToken(claimsFor("dueno"));

    const result = await authorizeRequest(
      "trabajador:registrar",
      { usuarioId: "trusted-id", __authToken: token },
      undefined,
      depsForSession("trabajador", audit),
    );

    expect(result.ok).toBe(false);
    if (!result.ok && !result.response.ok) {
      expect(result.response.error.code).toBe("FORBIDDEN");
    }
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("concede acceso con el rol de sesión aunque la fila de la cuenta indique otro rol", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "trusted-id",
      trabajadorId: 1,
      rut: "12345678-9",
      rolBd: "trabajador",
    });

    const audit = vi.fn(async () => undefined);
    const token = signSessionToken(claimsFor("dueno"));

    const result = await authorizeRequest(
      "trabajador:registrar",
      { usuarioId: "trusted-id", __authToken: token },
      undefined,
      depsForSession("dueno", audit),
    );

    expect(result.ok).toBe(true);
    expect(audit).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.context.claims?.rol).toBe("dueno");
      const payload = result.payload as { __rolSesion?: string };
      expect(payload.__rolSesion).toBe("dueno");
    }
  });

  it("mantiene el rol del JWT cuando la sesión es anterior a la migración (rol efectivo nulo)", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "trusted-id",
      trabajadorId: 1,
      rut: "12345678-9",
      rolBd: "dueno",
    });

    const token = signSessionToken(claimsFor("dueno"));

    const result = await authorizeRequest(
      "producto:listar",
      { __authToken: token },
      undefined,
      depsForSession(undefined, vi.fn(async () => undefined)),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.claims?.rol).toBe("dueno");
      const payload = result.payload as { __rolSesion?: string };
      expect(payload.__rolSesion).toBe("dueno");
    }
  });

  it("audita una mutación denegada de trabajador exactamente una vez", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "trusted-id",
      trabajadorId: 1,
      rut: "12345678-9",
      rolBd: "dueno",
    });

    const token = signSessionToken(claimsFor("dueno"));

    const result = await authorizeRequest(
      "trabajador:cambiar-estado",
      { usuarioId: "trusted-id", __authToken: token },
      undefined,
      depsForSession("trabajador", (event) =>
        registerAuditLog(testDb!.db, schema, event),
      ),
    );

    expect(result.ok).toBe(false);

    const rows = await testDb!.db.all<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM log_auditoria WHERE log_tipo_accion = 'acceso_denegado'`,
    );
    expect(Number(rows[0]?.total)).toBe(1);
  });
});

describe("persistencia de auditoría de guardChannel", () => {
  let testDb: AuthTestDatabase | undefined;

  beforeEach(async () => {
    testDb = await createAuthTestDatabase();
  });

  afterEach(async () => {
    if (!testDb) {
      return;
    }
    testDb.client.close();
    await removeAuthTempDir(testDb.dir);
    testDb = undefined;
  });

  it("persiste una fila acceso_denegado ante un rol no coincidente", async () => {
    await seedUser(testDb!.db, {
      usuarioId: "trusted-id",
      trabajadorId: 1,
      rut: "12345678-9",
      rolBd: "trabajador",
    });

    const result = await guardChannel(
      "producto:registrar",
      { __authToken: "t" },
      {
        verifyToken: () => claimsFor("trabajador"),
        audit: (event) => registerAuditLog(testDb!.db, schema, event),
      },
    );

    expect(result.ok).toBe(false);

    const rows = await testDb!.db.all<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM log_auditoria WHERE log_tipo_accion = 'acceso_denegado'`,
    );
    expect(Number(rows[0]?.total)).toBe(1);
  });
});

describe("authorizeRequest con sesion revocada (CU23/D10)", () => {
  it("informa el mensaje de revocación cuando el sistema cerró la sesión", async () => {
    const token = signSessionToken(claimsFor("dueno"));

    const result = await authorizeRequest(
      "producto:listar",
      { __authToken: token },
      undefined,
      {
        identity: guardChannel,
        session: async () => ({ active: false, reason: "sistema" }),
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok && !result.response.ok) {
      expect(result.response.error.code).toBe("FORBIDDEN");
      expect(result.response.error.message).toBe(SESSION_INVALIDATED_MESSAGE);
    }
  });
});
