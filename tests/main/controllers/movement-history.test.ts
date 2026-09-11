import { describe, expect, it } from "vitest";
import type { ControllerResponse } from "../../../src/shared/controllers";
import type { Role } from "../../../src/shared/navigation";
import type {
  MovementHistoryItem,
  MovementHistoryResponse,
  MovementHistoryFilters,
} from "../../../src/shared/inventory-detail";
import { createMovementHistoryController } from "../../../src/main/controllers/movement-history";
import {
  AccessDeniedError,
  type AuthenticatedUser,
} from "../../../src/main/controllers/auth-context";

function authorizeTestUser(
  usuarioId: string | undefined,
  allowedRoles: readonly Role[],
): AuthenticatedUser {
  const role =
    usuarioId === "dueno"
      ? "dueno"
      : usuarioId === "trabajador"
        ? "trabajador"
        : null;

  if (!role || !allowedRoles.includes(role)) {
    throw new AccessDeniedError();
  }

  return {
    role,
    usuarioId: usuarioId ?? "",
    usuarioRol: role,
    trabajadorNombre: role === "dueno" ? "Dueno Prueba" : "Trabajador Prueba",
  };
}

const sampleMovements: MovementHistoryItem[] = [
  {
    id: "lote-001",
    tipo: "ingreso_lote",
    fecha: "2026-08-01T10:00:00",
    cantidad: 50,
    productoEan13: "7802920000015",
    productoNombre: "Coca-Cola 1.5L",
    loteId: "lote-001",
    descripcion: "Ingreso de lote",
    usuario: "Juan Perez",
  },
  {
    id: "merma-001",
    tipo: "merma",
    fecha: "2026-08-05T14:00:00",
    cantidad: -3,
    productoEan13: "7802920000015",
    productoNombre: "Coca-Cola 1.5L",
    loteId: "lote-001",
    descripcion: "Merma por vencimiento",
    usuario: "Maria Lopez",
  },
  {
    id: "venta-001",
    tipo: "venta",
    fecha: "2026-08-10T16:30:00",
    cantidad: -2,
    productoEan13: "7802920000015",
    productoNombre: "Coca-Cola 1.5L",
    loteId: "lote-001",
    descripcion: "Venta v-001",
    usuario: "Carlos Diaz",
  },
  {
    id: "ajuste-001",
    tipo: "ajuste_manual",
    fecha: "2026-08-12T09:00:00",
    cantidad: 5,
    productoEan13: "7802920000015",
    productoNombre: "Coca-Cola 1.5L",
    loteId: "lote-001",
    descripcion: "Reconteo fisico",
    usuario: "Juan Perez",
  },
  {
    id: "lote-002",
    tipo: "ingreso_lote",
    fecha: "2026-07-15T08:00:00",
    cantidad: 100,
    productoEan13: "7802345600012",
    productoNombre: "Leche Soprole 1L",
    loteId: "lote-002",
    descripcion: "Ingreso de lote",
    usuario: "Juan Perez",
  },
];

function createController(
  overrides: {
    queryMovements?: (
      filters: MovementHistoryFilters,
    ) => Promise<MovementHistoryResponse>;
  } = {},
) {
  const queryMovements =
    overrides.queryMovements ??
    (async (filters: MovementHistoryFilters) => {
      let filtered = [...sampleMovements];

      if (filters.ean13) {
        filtered = filtered.filter(
          (m) => m.productoEan13 === filters.ean13,
        );
      }
      if (filters.tipo) {
        filtered = filtered.filter((m) => m.tipo === filters.tipo);
      }
      if (filters.loteId) {
        filtered = filtered.filter((m) => m.loteId === filters.loteId);
      }
      if (filters.fechaDesde) {
        filtered = filtered.filter(
          (m) => m.fecha >= filters.fechaDesde!,
        );
      }
      if (filters.fechaHasta) {
        filtered = filtered.filter(
          (m) => m.fecha < filters.fechaHasta! + "T99",
        );
      }

      filtered.sort((a, b) => b.fecha.localeCompare(a.fecha));

      const total = filtered.length;
      const start = (filters.page - 1) * filters.pageSize;
      const movements = filtered.slice(start, start + filters.pageSize);

      return { movements, total, page: filters.page, pageSize: filters.pageSize };
    });

  return createMovementHistoryController({
    authorize: async (usuarioId, allowedRoles) =>
      authorizeTestUser(usuarioId, allowedRoles),
    queryMovements,
  });
}

async function invokeHistory(
  payload?: unknown,
): Promise<ControllerResponse<MovementHistoryResponse>> {
  return createController().handle(payload, {
    channel: "movimiento:historial",
  }) as Promise<ControllerResponse<MovementHistoryResponse>>;
}

describe("movement history controller (C28)", () => {
  it("returns all movements sorted by date descending", async () => {
    const response = await invokeHistory({ usuarioId: "dueno" });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);

    expect(response.data.total).toBe(5);
    expect(response.data.movements[0].fecha).toBe("2026-08-12T09:00:00");
    expect(response.data.movements[4].fecha).toBe("2026-07-15T08:00:00");
  });

  it("returns movements from all four sources", async () => {
    const response = await invokeHistory({ usuarioId: "dueno" });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);

    const types = new Set(response.data.movements.map((m) => m.tipo));
    expect(types).toEqual(
      new Set(["ingreso_lote", "merma", "venta", "ajuste_manual"]),
    );
  });

  it("filters by EAN-13", async () => {
    const response = await invokeHistory({
      ean13: "7802345600012",
      usuarioId: "dueno",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);

    expect(response.data.total).toBe(1);
    expect(response.data.movements[0].productoNombre).toBe("Leche Soprole 1L");
  });

  it("filters by movement type", async () => {
    const response = await invokeHistory({
      tipo: "merma",
      usuarioId: "trabajador",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);

    expect(response.data.movements.every((m) => m.tipo === "merma")).toBe(true);
    expect(response.data.total).toBe(1);
  });

  it("filters by date range", async () => {
    const response = await invokeHistory({
      fechaDesde: "2026-08-05",
      fechaHasta: "2026-08-10",
      usuarioId: "dueno",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);

    for (const m of response.data.movements) {
      expect(m.fecha >= "2026-08-05").toBe(true);
      expect(m.fecha < "2026-08-10T99").toBe(true);
    }
  });

  it("filters by lot ID", async () => {
    const response = await invokeHistory({
      loteId: "lote-002",
      usuarioId: "dueno",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);

    expect(response.data.total).toBe(1);
    expect(response.data.movements[0].loteId).toBe("lote-002");
  });

  it("paginates results", async () => {
    const response = (await createController().handle(
      { pageSize: 2, page: 1, usuarioId: "dueno" },
      { channel: "movimiento:historial" },
    )) as ControllerResponse<MovementHistoryResponse>;

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);

    expect(response.data.movements).toHaveLength(2);
    expect(response.data.total).toBe(5);
    expect(response.data.page).toBe(1);
    expect(response.data.pageSize).toBe(2);

    const page2 = (await createController().handle(
      { pageSize: 2, page: 2, usuarioId: "dueno" },
      { channel: "movimiento:historial" },
    )) as ControllerResponse<MovementHistoryResponse>;

    expect(page2.ok).toBe(true);
    if (!page2.ok) throw new Error(page2.error.message);
    expect(page2.data.movements).toHaveLength(2);
    expect(page2.data.page).toBe(2);
  });

  it("returns empty list when no movements match filters", async () => {
    const response = await invokeHistory({
      ean13: "0000000000000",
      usuarioId: "dueno",
    });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);

    expect(response.data.movements).toEqual([]);
    expect(response.data.total).toBe(0);
  });

  it("rejects request without authorized user", async () => {
    const response = await invokeHistory({
      ean13: "7802920000015",
    });

    expect(response).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("rejects request on invalid IPC channel", async () => {
    const response = await createController().handle(
      { usuarioId: "dueno" },
      { channel: "canal:invalido" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "INVALID_CHANNEL" },
    });
  });

  it("returns DATABASE_ERROR for unexpected errors", async () => {
    const controller = createController({
      queryMovements: async () => {
        throw new Error("Connection lost");
      },
    });

    const response = await controller.handle(
      { usuarioId: "dueno" },
      { channel: "movimiento:historial" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "DATABASE_ERROR" },
    });
  });

  it("allows worker to access movement history", async () => {
    const response = await invokeHistory({ usuarioId: "trabajador" });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);
    expect(response.data.total).toBe(5);
  });

  it("shows negative quantities for merma and venta", async () => {
    const response = await invokeHistory({ usuarioId: "dueno" });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);

    const merma = response.data.movements.find((m) => m.tipo === "merma");
    const venta = response.data.movements.find((m) => m.tipo === "venta");
    expect(merma?.cantidad).toBeLessThan(0);
    expect(venta?.cantidad).toBeLessThan(0);
  });

  it("shows positive quantities for ingreso_lote and positive ajuste_manual", async () => {
    const response = await invokeHistory({ usuarioId: "dueno" });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);

    const ingreso = response.data.movements.find(
      (m) => m.tipo === "ingreso_lote",
    );
    const ajuste = response.data.movements.find(
      (m) => m.tipo === "ajuste_manual",
    );
    expect(ingreso?.cantidad).toBeGreaterThan(0);
    expect(ajuste?.cantidad).toBeGreaterThan(0);
  });
});
