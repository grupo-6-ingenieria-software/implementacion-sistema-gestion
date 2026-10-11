import { describe, expect, it } from "vitest";
import { controllers, ipcChannels } from "../../src/shared/controllers";
import { registeredControllers } from "../../src/main/controllers";

describe("registro de controladores", () => {
  it("declara una entrada de metadatos por id de controlador", () => {
    const ids = controllers.map((controller) => controller.id);

    expect(controllers).toHaveLength(53);
    expect(new Set(ids)).toHaveProperty("size", 53);
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
      "inventory-valuation",
      "daily-sales-report",
      "report-export",
      "monthly-sales",
      "products-most-sold",
      "sale-categories",
      "inventory-export",
      "waste-report",
      "expiring-lots-report",
      "movement-report",
      "category-profitability",
      "absence",
      "attendance-monthly-summary",
      "attendance-report",
    ]);
  });

  it("registra los mismos controladores en el proceso principal", () => {
    expect(
      registeredControllers.map((controller) => controller.metadata.id),
    ).toEqual(controllers.map((controller) => controller.id));
  });

  it("agrega C50 sin reutilizar canales de C33", () => {
    expect(controllers.find((controller) => controller.id === "inventory-export")).toMatchObject({
      id: "inventory-export", name: "ExportacionInventarioHandler",
      channels: ["inventario:exportar-productos"],
    });
    expect(new Set(ipcChannels.map(({ channel }) => channel)).size).toBe(ipcChannels.length);
  });

  it("asigna al menos un canal IPC a cada controlador", () => {
    expect(ipcChannels.length).toBeGreaterThanOrEqual(37);
    expect(
      controllers.every((controller) => controller.channels.length > 0),
    ).toBe(true);
    expect(new Set(ipcChannels.map((item) => item.channel)).size).toBe(ipcChannels.length);
  });

  it("agrega el controlador de proveedores de CU13 sin cambiar los índices previos", () => {
    expect(controllers.at(34)).toMatchObject({
      id: "supplier-create",
      name: "RegistrarProveedorHandler",
      channels: ["proveedor:categorias", "proveedor:registrar"],
    });
  });

  it("registra los canales de consulta y edición de CU14", () => {
    expect(controllers.slice(35, 37)).toMatchObject([
      {
        id: "supplier-query",
        channels: ["proveedor:listar", "proveedor:buscar-existente"],
      },
      { id: "supplier-edit", channels: ["proveedor:editar"] },
    ]);
  });

  it("agrega los controladores de CU16 sin cambiar los índices heredados", () => {
    expect(controllers.slice(37, 39)).toMatchObject([
      {
        id: "restock-list",
        name: "ReabastecimientoHandler",
        channels: ["inventario:lista-reabastecimiento"],
      },
      {
        id: "restock-report-export",
        name: "ExportacionReporteHandler",
        channels: ["inventario:reabastecimiento:exportar-pdf", "inventario:reabastecimiento:exportar-xlsx"],
      },
    ]);
  });

  it("agrega el controlador de solo lectura de CU19", () => {
    expect(controllers.at(39)).toMatchObject({
      id: "inventory-valuation",
      name: "ValorizacionHandler",
      channels: ["inventario:valorizacion"],
    });
  });

  it("registra la consulta de CU45 después de los controladores heredados", () => {
    expect(controllers.find((controller) => controller.id === "sale-categories")).toMatchObject({
      id: "sale-categories",
      name: "VentasCategoriaHandler",
      channels: ["venta:por-categoria"],
    });
  });

  it("agrega el controlador del reporte de mermas de CU49", () => {
    expect(controllers.find((c) => c.id === "waste-report")).toMatchObject({
      id: "waste-report",
      name: "ReporteMermasHandler",
      channels: ["reporte:mermas"],
    });
  });

  it("agrega C51 sin cambiar los índices heredados", () => {
    expect(controllers.at(50)).toMatchObject({ id: "absence", name: "AusenciaHandler", module: "personal", channels: ["ausencia:registrar"] });
  });

  it("mantiene remuneracion acotada a sus canales documentados", () => {
    expect(
      controllers.find((controller) => controller.id === "remuneracion")
        ?.channels,
    ).toEqual(["remuneracion:registrar", "remuneracion:trabajadores-elegibles"]);
  });

  it("mantiene configuracion previsional acotada a sus canales documentados", () => {
    expect(
      controllers.find(
        (controller) => controller.id === "configuracion-previsional",
      )?.channels,
    ).toEqual([
      "configuracion:previsional-obtener",
      "configuracion:previsional-actualizar",
    ]);
  });

  it("mantiene el controlador de lotes acotado a los canales de soporte del registro de lotes", () => {
    expect(
      controllers.find((controller) => controller.id === "lot")?.channels,
    ).toEqual(["lote:registrar", "lote:proveedores"]);
  });

  it("registra los canales de registro y disponibilidad de mermas", () => {
    expect(
      controllers.find((controller) => controller.id === "waste")?.channels,
    ).toEqual(["merma:registrar", "merma:disponibilidad"]);
  });

  it("mantiene la eliminación de productos acotada a su canal documentado", () => {
    expect(
      controllers.find((controller) => controller.id === "product-delete")
        ?.channels,
    ).toEqual(["producto:eliminar"]);
  });

  it("mantiene los canales de consulta compartidos de CU38/CU41 y el canal de anulación de CU38", () => {
    expect(
      controllers.find((controller) => controller.id === "sales-history")
        ?.channels,
    ).toEqual(["venta:historial-dia", "venta:buscar", "venta:detalle"]);
    expect(
      controllers.find((controller) => controller.id === "sale-annulment")
        ?.channels,
    ).toEqual(["venta:anular"]);
  });

  it("mantiene las operaciones de trabajador provistas por el alcance principal actual", () => {
    expect(
      controllers.find((controller) => controller.id === "worker")?.channels,
    ).toEqual([
      "trabajador:listar",
      "trabajador:registrar",
      "trabajador:actualizar",
      "trabajador:cambiar-estado",
      "trabajador:listar-activos",
      "trabajador:listar-para-resumen",
    ]);
  });

  it("mantiene todas las operaciones de turno en el controlador de turnos documentado", () => {
    expect(
      controllers.find((controller) => controller.id === "shift")?.channels,
    ).toEqual([
      "turno:crear",
      "turno:listar",
      "turno:editar",
      "turno:eliminar",
    ]);
  });

  it("registra el controlador del reporte de movimientos de CU53", () => {
    expect(
      controllers.find((controller) => controller.id === "movement-report"),
    ).toMatchObject({
      id: "movement-report",
      name: "ReporteMovimientosHandler",
      channels: ["reporte:movimientos-inventario"],
    });
  });
});
