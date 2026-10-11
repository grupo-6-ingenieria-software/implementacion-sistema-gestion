import { describe, expect, it, vi } from "vitest";
import {
  VIEW_UNAVAILABLE_MESSAGE,
  VIEW_UNAVAILABLE_TITLE,
  getLotCreateEan13,
  getProductDeleteEan13,
  getProductStatusEan13,
  getSupplierEditRut,
  getSaleAnnulmentVentaId,
  getWasteCreateEan13,
  isImplementedViewNodeId,
} from "../../../src/renderer/src/App";
import {
  buildShiftCreatePath,
  getShiftResultMessage,
  isLatestShiftCalendarRequest,
  loadShiftCalendarData,
} from "../../../src/renderer/src/views/ShiftCalendarView";
import {
  getActivePreselectedWorkerId,
  getShiftCreateContext,
} from "../../../src/renderer/src/views/ShiftCreateView";
import type { ControllerResponse } from "../../../src/shared/controllers";

describe("helpers de rutas de inventario de App", () => {
  it("trata V34 como vista implementada", () => {
    expect(isImplementedViewNodeId("absence-create")).toBe(true);
  });
  it("trata lot-create como vista implementada", () => {
    expect(isImplementedViewNodeId("lot-create")).toBe(true);
  });

  it("trata waste-create como vista implementada", () => {
    expect(isImplementedViewNodeId("waste-create")).toBe(true);
  });

  it("trata product-status como vista implementada", () => {
    expect(isImplementedViewNodeId("product-status")).toBe(true);
  });

  it("trata product-delete como vista implementada", () => {
    expect(isImplementedViewNodeId("product-delete")).toBe(true);
  });

  it("trata audit-log como vista implementada", () => {
    expect(isImplementedViewNodeId("audit-log")).toBe(true);
  });

  it("trata ambas rutas de turnos como vistas implementadas", () => {
    expect(isImplementedViewNodeId("shift-calendar")).toBe(true);
    expect(isImplementedViewNodeId("shift-create")).toBe(true);
    expect(isImplementedViewNodeId("shift-edit")).toBe(true);
  });

  it("trata CU38 como implementado y lee la consulta de venta V13", () => {
    expect(isImplementedViewNodeId("sale-annulment")).toBe(true);
    expect(
      getSaleAnnulmentVentaId(
        "/app/ventas/anular?ventaId=00000000-0000-4000-8000-000000000401",
      ),
    ).toBe("00000000-0000-4000-8000-000000000401");
  });

  it("trata CU41 como vista implementada", () => {
    expect(isImplementedViewNodeId("sales-query")).toBe(true);
  });

  it("trata CU19 como vista implementada", () => {
    expect(isImplementedViewNodeId("inventory-valuation")).toBe(true);
  });

  it("trata las rutas de proveedores de CU13 como vistas implementadas", () => {
    expect(isImplementedViewNodeId("supplier-list")).toBe(true);
    expect(isImplementedViewNodeId("supplier-create")).toBe(true);
  });

  it("implementa CU14 y decodifica el parámetro de ruta del RUT del proveedor", () => {
    expect(isImplementedViewNodeId("supplier-edit")).toBe(true);
    expect(
      getSupplierEditRut("/app/proveedores/12.345.678-5/editar"),
    ).toBe("12.345.678-5");
    expect(getSupplierEditRut("/app/proveedores/%E0%A4%A/editar")).toBeUndefined();
  });

  it("entrega y limpia los mensajes de éxito documentados de turnos", () => {
    expect(getShiftResultMessage("edit-success")).toBe(
      "Turno actualizado correctamente.",
    );
    expect(getShiftResultMessage("delete-success")).toBe(
      "Turno eliminado correctamente.",
    );
    expect(getShiftResultMessage("start-operation")).toBeNull();
  });

  it("transfiere la fecha seleccionada y el trabajador opcional de V16 a V17", () => {
    const path = buildShiftCreatePath("2026-06-15", 2);

    expect(path).toBe(
      "/app/personal/turnos/nuevo?fecha=15%2F06%2F2026&trabajadorId=2",
    );
    expect(getShiftCreateContext(path)).toEqual({
      fecha: "15/06/2026",
      trabajadorId: 2,
    });
    expect(
      getShiftCreateContext("/app/personal/turnos/nuevo?fecha=15%2F06%2F2026"),
    ).toEqual({
      fecha: "15/06/2026",
      trabajadorId: undefined,
    });
  });

  it("ignora parámetros de consulta V17 inválidos o no relacionados", () => {
    expect(
      getShiftCreateContext(
        "/app/personal/turnos/nuevo?fecha=31%2F02%2F2026&trabajadorId=-1&extra=1",
      ),
    ).toEqual({
      fecha: "",
      trabajadorId: undefined,
    });
  });

  it("preselecciona un trabajador solo mientras siga activo", () => {
    const activeWorkers = [
      {
        trabajadorId: 2,
        rut: "23456789-0",
        nombreCompleto: "Camila Rojas",
      },
    ];

    expect(getActivePreselectedWorkerId(activeWorkers, 2)).toBe("2");
    expect(getActivePreselectedWorkerId(activeWorkers, 3)).toBe("");
  });

  it("acepta solo la respuesta más reciente del calendario", () => {
    expect(isLatestShiftCalendarRequest(1, 2)).toBe(false);
    expect(isLatestShiftCalendarRequest(2, 2)).toBe(true);
  });

  it("carga trabajadores y turnos juntos al cargar y reintentar el calendario", async () => {
    const invoke = vi.fn(
      async (channel: string): Promise<ControllerResponse<unknown>> => {
        if (channel === "trabajador:listar-activos") {
          return { ok: true, data: [] };
        }

        return {
          ok: true,
          data: {
            inicioSemana: "2026-06-08",
            finSemana: "2026-06-14",
            turnos: [],
          },
        };
      },
    );

    await loadShiftCalendarData(invoke as typeof window.appApi.invoke, {
      usuarioId: "12345678-9",
      inicioSemana: "2026-06-08",
    });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "trabajador:listar-activos",
      "turno:listar",
    ]);
  });

  it("falla la carga del calendario cuando cualquiera de los recursos requeridos no está disponible", async () => {
    const invoke = vi.fn(
      async (channel: string): Promise<ControllerResponse<unknown>> =>
        channel === "trabajador:listar-activos"
          ? {
              ok: false,
              error: {
                code: "TECHNICAL_ERROR",
                message: "No fue posible cargar los trabajadores.",
              },
            }
          : {
              ok: true,
              data: {
                inicioSemana: "2026-06-08",
                finSemana: "2026-06-14",
                turnos: [],
              },
            },
    );

    await expect(
      loadShiftCalendarData(invoke as typeof window.appApi.invoke, {
        usuarioId: "12345678-9",
        inicioSemana: "2026-06-08",
      }),
    ).rejects.toThrow("No fue posible cargar los trabajadores.");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("lee el parámetro de ruta EAN-13 del estado del producto", () => {
    expect(
      getProductStatusEan13("/app/inventario/productos/7802920000015/estado"),
    ).toBe("7802920000015");
  });

  it("lee el parámetro de consulta EAN-13 contextual", () => {
    expect(
      getLotCreateEan13("/app/inventario/lotes/nuevo?ean13=7802920000015"),
    ).toBe("7802920000015");
  });

  it("lee el parámetro de consulta EAN-13 contextual para el registro de mermas", () => {
    expect(
      getWasteCreateEan13("/app/inventario/mermas/nueva?ean13=7802920000015"),
    ).toBe("7802920000015");
  });

  it("lee el parámetro de consulta EAN-13 contextual para la eliminación de productos", () => {
    expect(
      getProductDeleteEan13(
        "/app/inventario/productos/eliminar?ean13=7802920000015",
      ),
    ).toBe("7802920000015");
  });

  it("expone un mensaje de respaldo neutro sin trazabilidad interna", () => {
    expect(VIEW_UNAVAILABLE_TITLE).toBe("Vista no disponible");
    expect(VIEW_UNAVAILABLE_MESSAGE).toBe(
      "La vista solicitada no está disponible.",
    );

    const fallbackText = `${VIEW_UNAVAILABLE_TITLE} ${VIEW_UNAVAILABLE_MESSAGE}`;

    expect(fallbackText).not.toContain("Controladores");
    expect(fallbackText).not.toContain("Componentes internos");
  });
});
