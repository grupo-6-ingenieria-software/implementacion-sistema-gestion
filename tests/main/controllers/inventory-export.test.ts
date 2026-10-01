import { describe, expect, it, vi } from "vitest";
import type { SessionTokenClaims } from "../../../src/main/controllers/auth-jwt";
import { AccessDeniedError } from "../../../src/main/controllers/auth-context";
import {
  CHANNEL_ROLES,
  authorizeRequest,
  guardChannel,
} from "../../../src/main/controllers/auth-guard";
import {
  createInventoryExportController,
  type InventoryExportDependencies,
} from "../../../src/main/controllers/inventory-export";
import { InventoryExportDataError } from "../../../src/main/controllers/inventory-export-query";
import {
  INVENTORY_AUDIT_WARNING,
  INVENTORY_EMPTY_MESSAGE,
  INVENTORY_EXPORT_CHANNEL,
  INVENTORY_EXPORT_ERROR_MESSAGE,
  type InventoryExportItem,
} from "../../../src/shared/inventory-export";

const item: InventoryExportItem = {
  productoId: 1,
  ean13: "0000000000001",
  nombre: "Leche",
  categoria: "Lácteos",
  stockActual: 7,
  stockMinimo: 4,
  precioCosto: 80,
  precioVenta: 150,
  estado: "inactivo",
};
const claims = (
  rol: "dueno" | "trabajador" = "trabajador",
): SessionTokenClaims => ({
  usuarioId: "trusted",
  rol,
  usuarioRol: rol,
  passwordTemporal: false,
  sesionId: "session",
});
const context = (rol: "dueno" | "trabajador" = "trabajador") => ({
  channel: INVENTORY_EXPORT_CHANNEL,
  claims: claims(rol),
});
function dependencies(
  overrides: Partial<InventoryExportDependencies> = {},
): InventoryExportDependencies {
  return {
    authorize: vi.fn(async (usuarioId, role) => ({
      usuarioId,
      role,
      usuarioRol: role,
      trabajadorNombre: "Camila Rojas",
    })),
    query: vi.fn(async () => [item]),
    showSaveDialog: vi.fn(async () => ({
      canceled: false,
      filePath: "C:/Documentos/inventario.pdf",
    })),
    confirmDestination: vi.fn(async () => true),
    createPdf: vi.fn(async () => Buffer.from("pdf")),
    createXlsx: vi.fn(async () => Buffer.from("xlsx")),
    save: vi.fn(async () => undefined),
    audit: vi.fn(async () => undefined),
    now: () => new Date("2026-09-12T23:30:00Z"),
    documentsPath: () => "C:/Documentos",
    logError: vi.fn(),
    ...overrides,
  };
}

describe("CU20 C50 orchestration", () => {
  it.each(["dueno", "trabajador"] as const)(
    "exports prices and all rows for %s using trusted claims (T01/T04)",
    async (role) => {
      expect(CHANNEL_ROLES.get(INVENTORY_EXPORT_CHANNEL)).toEqual(
        new Set(["dueno", "trabajador"]),
      );
      const deps = dependencies();
      const result = await createInventoryExportController(deps).handle(
        {
          formato: "pdf",
          usuarioId: "attacker",
          filas: [],
          ruta: "evil",
          usuario: "Inventado",
          filtros: { activo: true },
        },
        context(role),
      );
      expect(result).toMatchObject({
        ok: true,
        data: { estado: "saved", cantidadFilas: 1, auditoria: "registrada" },
      });
      expect(deps.authorize).toHaveBeenCalledWith("trusted", role);
      expect(deps.createPdf).toHaveBeenCalledWith({
        negocio: "Minimarket y Panadería Huáscar",
        fecha: "12-09-2026 20:30",
        fechaGeneracion: "2026-09-12T23:30:00.000Z",
        usuario: "Camila Rojas",
        items: [item],
      });
      expect(deps.createXlsx).not.toHaveBeenCalled();
      expect(deps.audit).toHaveBeenCalledWith("trusted", "pdf", 1);
      expect(vi.mocked(deps.audit).mock.invocationCallOrder[0]).toBeGreaterThan(
        vi.mocked(deps.save).mock.invocationCallOrder[0],
      );
    },
  );
  it("generates only XLSX when selected", async () => {
    const deps = dependencies();
    await createInventoryExportController(deps).handle(
      { formato: "xlsx" },
      context(),
    );
    expect(deps.createPdf).not.toHaveBeenCalled();
    expect(deps.createXlsx).toHaveBeenCalledOnce();
    expect(deps.save).toHaveBeenCalledWith(
      "C:/Documentos/inventario.xlsx",
      Buffer.from("xlsx"),
    );
  });
  it.each(["pdf", "xlsx"])(
    "returns exact E1 before dialog for %s (T08)",
    async (formato) => {
      const deps = dependencies({ query: vi.fn(async () => []) });
      expect(
        await createInventoryExportController(deps).handle(
          { formato },
          context(),
        ),
      ).toMatchObject({
        ok: false,
        error: { code: "BUSINESS_RULE", message: INVENTORY_EMPTY_MESSAGE },
      });
      for (const action of [
        deps.showSaveDialog,
        deps.createPdf,
        deps.createXlsx,
        deps.save,
        deps.audit,
      ])
        expect(action).not.toHaveBeenCalled();
    },
  );
  it.each(["native", "overwrite"])(
    "handles %s cancellation without generation (T11)",
    async (kind) => {
      const deps = dependencies(
        kind === "native"
          ? { showSaveDialog: vi.fn(async () => ({ canceled: true })) }
          : { confirmDestination: vi.fn(async () => false) },
      );
      expect(
        await createInventoryExportController(deps).handle(
          { formato: "pdf" },
          context(),
        ),
      ).toMatchObject({ ok: true, data: { estado: "cancelled" } });
      for (const action of [
        deps.createPdf,
        deps.createXlsx,
        deps.save,
        deps.audit,
      ])
        expect(action).not.toHaveBeenCalled();
    },
  );
  it.each(["csv", "", undefined, 42])(
    "rejects invalid format %s",
    async (formato) => {
      const deps = dependencies();
      expect(
        await createInventoryExportController(deps).handle(
          { formato },
          context(),
        ),
      ).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
      expect(deps.query).not.toHaveBeenCalled();
    },
  );
  it("rejects missing claims and inactive users without querying", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => {
        throw new AccessDeniedError();
      }),
    });
    const controller = createInventoryExportController(deps);
    expect(
      await controller.handle(
        { formato: "pdf", usuarioId: "trusted" },
        { channel: INVENTORY_EXPORT_CHANNEL },
      ),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await controller.handle({ formato: "pdf" }, context()),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(deps.query).not.toHaveBeenCalled();
  });
  it.each([
    "query",
    "createPdf",
    "createXlsx",
    "save",
    "showSaveDialog",
    "confirmDestination",
  ] as const)(
    "maps %s failure to exact E2 and never audits (T09)",
    async (action) => {
      const deps = dependencies();
      vi.mocked(deps[action]).mockRejectedValueOnce(
        new Error("technical failure"),
      );
      const result = await createInventoryExportController(deps).handle(
        { formato: action === "createXlsx" ? "xlsx" : "pdf" },
        context(),
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: action === "query" ? "DATABASE_ERROR" : "TECHNICAL_ERROR",
          message: INVENTORY_EXPORT_ERROR_MESSAGE,
        },
      });
      expect(deps.audit).not.toHaveBeenCalled();
      expect(deps.logError).toHaveBeenCalledOnce();
    },
  );
  it("maps invalid prices to E2 without asking for a destination", async () => {
    const deps = dependencies({
      query: vi.fn(async () => {
        throw new InventoryExportDataError([
          { productoId: 1, motivo: "historial_vigente_no_unico" },
        ]);
      }),
    });
    expect(
      await createInventoryExportController(deps).handle(
        { formato: "pdf" },
        context(),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "BUSINESS_RULE", message: INVENTORY_EXPORT_ERROR_MESSAGE },
    });
    expect(deps.showSaveDialog).not.toHaveBeenCalled();
  });
  it("keeps saved success with an audit warning, even if the logger also fails (T10)", async () => {
    const deps = dependencies({
      audit: vi.fn(async () => {
        throw new Error("audit failure");
      }),
      logError: vi.fn(() => {
        throw new Error("log failure");
      }),
    });
    expect(
      await createInventoryExportController(deps).handle(
        { formato: "pdf" },
        context(),
      ),
    ).toMatchObject({
      ok: true,
      data: {
        estado: "saved",
        auditoria: "fallida",
        advertencia: INVENTORY_AUDIT_WARNING,
      },
    });
    expect(deps.save).toHaveBeenCalledOnce();
  });
  it("does not report success for an empty buffer or a wrong channel", async () => {
    const deps = dependencies({
      createPdf: vi.fn(async () => Buffer.alloc(0)),
    });
    const controller = createInventoryExportController(deps);
    expect(
      await controller.handle({ formato: "pdf" }, context()),
    ).toMatchObject({
      ok: false,
      error: { message: INVENTORY_EXPORT_ERROR_MESSAGE },
    });
    expect(deps.save).not.toHaveBeenCalled();
    expect(await controller.handle({}, { channel: "other" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_CHANNEL" },
    });
  });
});

describe("CU20 dispatch guard (T01)", () => {
  it("rejects invalid tokens and revoked sessions before C50", async () => {
    const audit = vi.fn(async () => undefined);
    expect(
      (
        await guardChannel(
          INVENTORY_EXPORT_CHANNEL,
          { __authToken: "bad" },
          { verifyToken: () => null, audit },
        )
      ).ok,
    ).toBe(false);
    const identity = (channel: string, payload: unknown) =>
      guardChannel(channel, payload, { verifyToken: () => claims(), audit });
    expect(
      (
        await authorizeRequest(
          INVENTORY_EXPORT_CHANNEL,
          { formato: "pdf" },
          undefined,
          {
            identity,
            session: async () => ({ active: false, reason: "manual" }),
          },
        )
      ).ok,
    ).toBe(false);
  });
});
