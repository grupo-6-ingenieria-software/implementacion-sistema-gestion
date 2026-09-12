import { describe, expect, it } from "vitest";
import { controllers, ipcChannels } from "../../src/shared/controllers";
import { registeredControllers } from "../../src/main/controllers";

describe("controller registry", () => {
  it("declares one metadata entry per controller id", () => {
    const ids = controllers.map((controller) => controller.id);

    expect(controllers).toHaveLength(39);
    expect(new Set(ids)).toHaveProperty("size", 39);
    expect(ids).toEqual([
      "auth-login",
      "password",
      "access-control",
      "audit",
      "session",
      "dashboard",
      "stock-alert",
      "expiration-alert",
      "daily-sales-total",
      "product-create",
      "product-edit",
      "product-status",
      "product-query",
      "lot",
      "waste",
      "sale",
      "stock-discount",
      "sales-history",
      "cash-closing",
      "cash-check",
      "worker",
      "shift",
      "attendance",
      "ean-reader",
      "user-management",
      "product-delete",
      "sale-annulment",
      "product-detail",
      "stock-adjustment",
      "movement-history",
      "remuneracion",
      "configuracion-previsional",
      "supplier-order",
      "supplier-order-reception",
      "supplier-create",
      "supplier-query",
      "supplier-edit",
      "restock-list",
      "restock-report-export",
    ]);
  });

  it("registers the same controllers in the main process", () => {
    expect(
      registeredControllers.map((controller) => controller.metadata.id),
    ).toEqual(controllers.map((controller) => controller.id));
  });

  it("assigns at least one IPC channel to every controller", () => {
    expect(ipcChannels.length).toBeGreaterThanOrEqual(37);
    expect(
      controllers.every((controller) => controller.channels.length > 0),
    ).toBe(true);
  });

  it("appends the CU13 supplier controller without changing prior indices", () => {
    expect(controllers.at(34)).toMatchObject({
      id: "supplier-create",
      name: "RegistrarProveedorHandler",
      channels: ["proveedor:categorias", "proveedor:registrar"],
    });
  });

  it("registers the CU14 query and edit channels", () => {
    expect(controllers.slice(-4, -2)).toMatchObject([
      {
        id: "supplier-query",
        channels: ["proveedor:listar", "proveedor:buscar-existente"],
      },
      { id: "supplier-edit", channels: ["proveedor:editar"] },
    ]);
  });

  it("appends the CU16 controllers without changing inherited indices", () => {
    expect(controllers.slice(-2)).toMatchObject([
      {
        id: "restock-list",
        name: "ReabastecimientoHandler",
        channels: ["inventario:lista-reabastecimiento"],
      },
      {
        id: "restock-report-export",
        name: "ExportacionReporteHandler",
        channels: ["reporte:exportar-pdf", "reporte:exportar-xlsx"],
      },
    ]);
  });

  it("keeps remuneracion scoped to its documented channels", () => {
    expect(
      controllers.find((controller) => controller.id === "remuneracion")
        ?.channels,
    ).toEqual(["remuneracion:registrar", "remuneracion:trabajadores-elegibles"]);
  });

  it("keeps configuracion previsional scoped to its documented channels", () => {
    expect(
      controllers.find(
        (controller) => controller.id === "configuracion-previsional",
      )?.channels,
    ).toEqual([
      "configuracion:previsional-obtener",
      "configuracion:previsional-actualizar",
    ]);
  });

  it("keeps the lot controller scoped to lot registration support channels", () => {
    expect(
      controllers.find((controller) => controller.id === "lot")?.channels,
    ).toEqual(["lote:registrar", "lote:proveedores"]);
  });

  it("registers waste registration and availability channels", () => {
    expect(
      controllers.find((controller) => controller.id === "waste")?.channels,
    ).toEqual(["merma:registrar", "merma:disponibilidad"]);
  });

  it("keeps product deletion scoped to its documented channel", () => {
    expect(
      controllers.find((controller) => controller.id === "product-delete")
        ?.channels,
    ).toEqual(["producto:eliminar"]);
  });

  it("keeps the shared CU38/CU41 query channels and CU38 annulment channel", () => {
    expect(
      controllers.find((controller) => controller.id === "sales-history")
        ?.channels,
    ).toEqual(["venta:historial-dia", "venta:buscar", "venta:detalle"]);
    expect(
      controllers.find((controller) => controller.id === "sale-annulment")
        ?.channels,
    ).toEqual(["venta:anular"]);
  });

  it("keeps the worker operations provided by the current main scope", () => {
    expect(
      controllers.find((controller) => controller.id === "worker")?.channels,
    ).toEqual([
      "trabajador:listar",
      "trabajador:registrar",
      "trabajador:actualizar",
      "trabajador:cambiar-estado",
      "trabajador:listar-activos",
    ]);
  });

  it("keeps all turn operations in the documented shift controller", () => {
    expect(
      controllers.find((controller) => controller.id === "shift")?.channels,
    ).toEqual([
      "turno:crear",
      "turno:listar",
      "turno:editar",
      "turno:eliminar",
    ]);
  });
});
