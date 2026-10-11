import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSalesHistoryController,
  findSaleForAnnulment,
  loadDailySalesHistory,
  loadSaleDetail,
  SaleHistoryValidationError,
  SaleLookupBusinessError,
  SaleLookupNotFoundError,
  SaleLookupValidationError,
  searchSalesHistory,
  type SalesHistoryDb,
} from "../../../src/main/controllers/sales-history";

const allMock = vi.fn();
const database: SalesHistoryDb = {
  all: allMock,
};
const dialect = new SQLiteSyncDialect();

beforeEach(() => {
  allMock.mockReset().mockResolvedValue([]);
});

const saleId = "00000000-0000-4000-8000-000000000401";

describe("búsqueda y detalle de venta CU38", () => {
  it("encuentra una venta vigente válida usando los límites del día chileno", async () => {
    allMock.mockResolvedValueOnce([
      {
        ventaId: saleId,
        estado: "completada",
        esDelDia: 1,
        anulacionVentaId: null,
      },
    ]);

    await expect(
      findSaleForAnnulment(
        database,
        { ventaId: saleId },
        new Date("2026-06-11T12:00:00Z"),
      ),
    ).resolves.toEqual({ ventaId: saleId });

    expect(toQuery(allMock.mock.calls[0][0]).params).toEqual([
      "2026-06-11 04:00:00",
      "2026-06-12 04:00:00",
      saleId,
    ]);
  });

  it("distingue ventas inválidas, inexistentes, de día anterior y anuladas", async () => {
    await expect(
      findSaleForAnnulment(database, { ventaId: "venta-1" }),
    ).rejects.toBeInstanceOf(SaleLookupValidationError);

    allMock.mockResolvedValueOnce([]);
    await expect(
      findSaleForAnnulment(database, { ventaId: saleId }),
    ).rejects.toBeInstanceOf(SaleLookupNotFoundError);

    allMock.mockResolvedValueOnce([
      {
        ventaId: saleId,
        estado: "completada",
        esDelDia: 0,
        anulacionVentaId: null,
      },
    ]);
    await expect(
      findSaleForAnnulment(database, { ventaId: saleId }),
    ).rejects.toThrow("día actual");

    allMock.mockResolvedValueOnce([
      {
        ventaId: saleId,
        estado: "completada",
        esDelDia: 1,
        anulacionVentaId: "annulment-1",
      },
    ]);
    await expect(
      findSaleForAnnulment(database, { ventaId: saleId }),
    ).rejects.toBeInstanceOf(SaleLookupBusinessError);
  });

  it("construye el detalle con precios históricos, descuento, caja y estado", async () => {
    allMock
      .mockResolvedValueOnce([
        {
          ventaId: saleId,
          fechaHora: "2026-06-11T18:30:00.000Z",
          estado: "completada",
          discountType: "porcentaje",
          discountValue: 10,
          discountReason: "Cliente frecuente",
          metodoPago: "efectivo",
          montoRecibido: 5000,
          usuarioId: "usuario-1",
          responsable: "Maria Huascar",
          responsableRol: "trabajador",
          cierreCajaId: "caja-1",
          cajaEstado: "cerrado",
          fechaApertura: "2026-06-11T08:00:00.000Z",
          fechaCierre: "2026-06-11T22:00:00.000Z",
          anulacionVentaId: "annulment-1",
        },
      ])
      .mockResolvedValueOnce([
        {
          productoId: 1,
          ean13: "7802920000015",
          nombre: "Pan",
          cantidad: 2,
          precioUnitario: 1500,
        },
        {
          productoId: 2,
          ean13: "7802920000022",
          nombre: "Leche",
          cantidad: 1,
          precioUnitario: 1000,
        },
      ]);

    await expect(loadSaleDetail(database, { ventaId: saleId })).resolves.toEqual(
      {
        ventaId: saleId,
        fechaHora: "2026-06-11T18:30:00.000Z",
        estado: "anulada",
        responsable: {
          usuarioId: "usuario-1",
          nombre: "Maria Huascar",
          rol: "trabajador",
        },
        productos: [
          {
            productoId: 1,
            ean13: "7802920000015",
            nombre: "Pan",
            cantidad: 2,
            precioUnitario: 1500,
            subtotal: 3000,
          },
          {
            productoId: 2,
            ean13: "7802920000022",
            nombre: "Leche",
            cantidad: 1,
            precioUnitario: 1000,
            subtotal: 1000,
          },
        ],
        descuento: {
          tipo: "porcentaje",
          valor: 10,
          razon: "Cliente frecuente",
        },
        pago: { metodo: "efectivo", montoRecibido: 5000, vuelto: 1400 },
        subtotal: 4000,
        total: 3600,
        caja: {
          cierreCajaId: "caja-1",
          estado: "cerrada",
          fechaApertura: "2026-06-11T08:00:00.000Z",
          fechaCierre: "2026-06-11T22:00:00.000Z",
        },
      },
    );
  });
});

describe("búsqueda de historial de ventas CU41", () => {
  it("usa un rango chileno inclusivo y mapea totales históricos y elegibilidad", async () => {
    allMock.mockResolvedValueOnce([
      {
        ventaId: "00000000-0000-4000-8000-000000000403",
        fechaHora: "2026-06-12T18:00:00.000Z",
        metodoPago: "debito",
        estado: "completada",
        discountType: "monto",
        discountValue: 500,
        usuarioId: "u-1",
        responsable: "Ana Prueba",
        responsableRol: "dueno",
        cajaEstado: "abierto",
        anulacionVentaId: null,
        subtotal: 3000,
        esDelDia: 1,
      },
      {
        ventaId: "00000000-0000-4000-8000-000000000402",
        fechaHora: "2026-06-11T17:00:00.000Z",
        metodoPago: "efectivo",
        estado: "completada",
        discountType: "porcentaje",
        discountValue: 10,
        usuarioId: "u-2",
        responsable: "Luis Soto",
        responsableRol: "trabajador",
        cajaEstado: "cerrado",
        anulacionVentaId: "annulment-1",
        subtotal: 5000,
        esDelDia: 0,
      },
      {
        ventaId: "00000000-0000-4000-8000-000000000401",
        fechaHora: "2026-06-10T15:00:00.000Z",
        metodoPago: "transferencia",
        estado: "completada",
        discountType: "ninguno",
        discountValue: null,
        usuarioId: "u-1",
        responsable: "Ana Prueba",
        responsableRol: "dueno",
        cajaEstado: "cerrado",
        anulacionVentaId: null,
        subtotal: 2000,
        esDelDia: 0,
      },
    ]);

    await expect(
      searchSalesHistory(
        database,
        {
          criterio: "rango",
          fechaInicio: "2026-06-10",
          fechaTermino: "2026-06-12",
        },
        new Date("2026-06-12T18:00:00.000Z"),
      ),
    ).resolves.toEqual({
      ventas: [
        expect.objectContaining({
          ventaId: "00000000-0000-4000-8000-000000000403",
          total: 2500,
          estado: "confirmada",
          puedeAnular: true,
        }),
        expect.objectContaining({
          ventaId: "00000000-0000-4000-8000-000000000402",
          total: 4500,
          estado: "anulada",
          puedeAnular: false,
        }),
        expect.objectContaining({
          ventaId: "00000000-0000-4000-8000-000000000401",
          total: 2000,
          estado: "confirmada",
          puedeAnular: false,
        }),
      ],
      resumen: {
        ventasVigentes: 2,
        montoVigente: 4500,
        ventasAnuladas: 1,
      },
    });

    const query = toQuery(allMock.mock.calls[0][0]);
    expect(query.params).toEqual([
      "2026-06-12 04:00:00",
      "2026-06-13 04:00:00",
      "2026-06-10 04:00:00",
      "2026-06-13 04:00:00",
    ]);
    expect(query.sql).toContain(
      "ORDER BY datetime(v.venta_fecha_hora) DESC, v.venta_id DESC",
    );
  });

  it("busca un UUID completo de forma exacta sin restricción de fecha", async () => {
    allMock.mockResolvedValueOnce([]);

    await expect(
      searchSalesHistory(
        database,
        { criterio: "numero", ventaId: `  ${saleId.toUpperCase()}  ` },
        new Date("2026-06-12T18:00:00.000Z"),
      ),
    ).resolves.toEqual({
      ventas: [],
      resumen: { ventasVigentes: 0, montoVigente: 0, ventasAnuladas: 0 },
    });

    const query = toQuery(allMock.mock.calls[0][0]);
    expect(query.params).toEqual([
      "2026-06-12 04:00:00",
      "2026-06-13 04:00:00",
      saleId.toUpperCase(),
    ]);
  });

  it.each([
    { criterio: "numero", ventaId: "venta-1" },
    { criterio: "rango", fechaInicio: "", fechaTermino: "2026-06-12" },
    { criterio: "rango", fechaInicio: "2026-02-29", fechaTermino: "2026-03-01" },
    { criterio: "rango", fechaInicio: "2026-06-13", fechaTermino: "2026-06-12" },
    { criterio: "desconocido" },
  ])("rechaza solicitudes directas inválidas antes de consultar: $criterio", async (payload) => {
    await expect(
      searchSalesHistory(database, payload as never),
    ).rejects.toBeInstanceOf(SaleHistoryValidationError);
    expect(allMock).not.toHaveBeenCalled();
  });
});

describe("consulta del historial de ventas diarias", () => {
  it("usa los límites de invierno de Chile y ordena primero las ventas más recientes", async () => {
    allMock.mockResolvedValueOnce([]);

    await loadDailySalesHistory(database, new Date("2026-06-11T12:00:00Z"));

    const query = toQuery(allMock.mock.calls[0][0]);

    expect(query.params).toEqual([
      "2026-06-11 04:00:00",
      "2026-06-12 04:00:00",
    ]);
    expect(query.sql).toContain(
      "ORDER BY datetime(v.venta_fecha_hora) DESC, v.venta_id DESC",
    );
  });

  it("usa los límites de verano de Chile", async () => {
    allMock.mockResolvedValueOnce([]);

    await loadDailySalesHistory(database, new Date("2026-01-15T12:00:00Z"));

    expect(toQuery(allMock.mock.calls[0][0]).params).toEqual([
      "2026-01-15 03:00:00",
      "2026-01-16 03:00:00",
    ]);
  });

  it("mapea las ventas y excluye las anuladas de los totales vigentes", async () => {
    allMock
      .mockResolvedValueOnce([
        {
          ventaId: "venta-3",
          fechaHora: "2026-06-11T18:30:00.000Z",
          metodoPago: "debito",
          estado: "completada",
          discountType: "monto",
          discountValue: "500",
          usuarioId: "u-1",
          responsable: "Maria Huascar",
          responsableRol: "dueno",
        },
        {
          ventaId: "venta-2",
          fechaHora: "2026-06-11T17:00:00.000Z",
          metodoPago: "efectivo",
          estado: "anulada",
          discountType: "porcentaje",
          discountValue: "10",
          usuarioId: "u-2",
          responsable: "Luis Soto",
          responsableRol: "trabajador",
        },
        {
          ventaId: "venta-1",
          fechaHora: "2026-06-11T15:00:00.000Z",
          metodoPago: "efectivo",
          estado: "completada",
          discountType: "ninguno",
          discountValue: null,
          usuarioId: "u-1",
          responsable: "Maria Huascar",
          responsableRol: "dueno",
        },
      ])
      .mockResolvedValueOnce([
        {
          ventaId: "venta-3",
          cantidad: "2",
          historialPrecioProductoId: "p-3a",
        },
        {
          ventaId: "venta-3",
          cantidad: "1",
          historialPrecioProductoId: "p-3b",
        },
        { ventaId: "venta-2", cantidad: "2", historialPrecioProductoId: "p-2" },
        { ventaId: "venta-1", cantidad: "1", historialPrecioProductoId: "p-1" },
      ])
      .mockResolvedValueOnce([
        { historialPrecioProductoId: "p-3a", precio: "1500" },
        { historialPrecioProductoId: "p-3b", precio: "2000" },
        { historialPrecioProductoId: "p-2", precio: "5000" },
        { historialPrecioProductoId: "p-1", precio: "2000" },
      ])
      .mockResolvedValueOnce([{ ventaId: "venta-2" }]);

    await expect(
      loadDailySalesHistory(database, new Date("2026-06-11T12:00:00Z")),
    ).resolves.toEqual({
      ventas: [
        {
          ventaId: "venta-3",
          fechaHora: "2026-06-11T18:30:00.000Z",
          responsable: {
            usuarioId: "u-1",
            nombre: "Maria Huascar",
            rol: "dueno",
          },
          cantidadProductos: 3,
          total: 4500,
          metodoPago: "debito",
          estado: "confirmada",
        },
        {
          ventaId: "venta-2",
          fechaHora: "2026-06-11T17:00:00.000Z",
          responsable: {
            usuarioId: "u-2",
            nombre: "Luis Soto",
            rol: "trabajador",
          },
          cantidadProductos: 2,
          total: 9000,
          metodoPago: "efectivo",
          estado: "anulada",
        },
        {
          ventaId: "venta-1",
          fechaHora: "2026-06-11T15:00:00.000Z",
          responsable: {
            usuarioId: "u-1",
            nombre: "Maria Huascar",
            rol: "dueno",
          },
          cantidadProductos: 1,
          total: 2000,
          metodoPago: "efectivo",
          estado: "confirmada",
        },
      ],
      resumen: {
        ventasVigentes: 2,
        montoVigente: 6500,
        porMetodoPago: {
          efectivo: { cantidadVentas: 1, monto: 2000 },
          debito: { cantidadVentas: 1, monto: 4500 },
          credito: { cantidadVentas: 0, monto: 0 },
          transferencia: { cantidadVentas: 0, monto: 0 },
        },
        ventasAnuladas: 1,
        montoAnulado: 9000,
      },
    });
  });

  it("devuelve una lista vacía y un resumen en cero cuando el día no tiene ventas", async () => {
    allMock.mockResolvedValueOnce([]);

    await expect(loadDailySalesHistory(database)).resolves.toEqual({
      ventas: [],
      resumen: {
        ventasVigentes: 0,
        montoVigente: 0,
        porMetodoPago: {
          efectivo: { cantidadVentas: 0, monto: 0 },
          debito: { cantidadVentas: 0, monto: 0 },
          credito: { cantidadVentas: 0, monto: 0 },
          transferencia: { cantidadVentas: 0, monto: 0 },
        },
        ventasAnuladas: 0,
        montoAnulado: 0,
      },
    });
    expect(allMock).toHaveBeenCalledOnce();
  });
});

describe("controlador del historial de ventas", () => {
  it("enruta búsquedas CU41 sin cambiar la forma de solicitud heredada de CU38", async () => {
    const controller = createSalesHistoryController(
      database,
      () => new Date("2026-06-12T18:00:00.000Z"),
    );
    allMock.mockResolvedValueOnce([]);

    await expect(
      controller.handle(
        {
          criterio: "rango",
          fechaInicio: "2026-06-11",
          fechaTermino: "2026-06-12",
        },
        { channel: "venta:buscar" },
      ),
    ).resolves.toEqual({
      ok: true,
      data: {
        ventas: [],
        resumen: { ventasVigentes: 0, montoVigente: 0, ventasAnuladas: 0 },
      },
    });

    allMock.mockResolvedValueOnce([
      {
        ventaId: saleId,
        estado: "completada",
        esDelDia: 1,
        anulacionVentaId: null,
      },
    ]);
    await expect(
      controller.handle({ ventaId: saleId }, { channel: "venta:buscar" }),
    ).resolves.toEqual({ ok: true, data: { ventaId: saleId } });
  });

  it("mapea filtros CU41 inválidos a un error de validación público", async () => {
    const controller = createSalesHistoryController(database);
    await expect(
      controller.handle(
        {
          criterio: "rango",
          fechaInicio: "2026-06-13",
          fechaTermino: "2026-06-12",
        },
        { channel: "venta:buscar" },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", controllerId: "sales-history" },
    });
    expect(allMock).not.toHaveBeenCalled();
  });

  it("devuelve un error técnico sin exponer detalles de la base de datos", async () => {
    const error = new Error("database connection details");
    const failingDatabase: SalesHistoryDb = {
      all: vi.fn().mockRejectedValue(error),
    };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const controller = createSalesHistoryController(
      failingDatabase,
      () => new Date("2026-06-11T12:00:00Z"),
    );

    await expect(
      controller.handle(undefined, { channel: "venta:historial-dia" }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "TECHNICAL_ERROR",
        controllerId: "sales-history",
        message: "No fue posible cargar las ventas del dia.",
      },
    });
    expect(consoleError).toHaveBeenCalledWith(error);

    consoleError.mockRestore();
  });

  it("devuelve un error técnico genérico para búsquedas CU41", async () => {
    const error = new Error("database connection details");
    const failingDatabase: SalesHistoryDb = {
      all: vi.fn().mockRejectedValue(error),
    };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const controller = createSalesHistoryController(
      failingDatabase,
      () => new Date("2026-06-11T12:00:00Z"),
    );

    await expect(
      controller.handle(
        {
          criterio: "rango",
          fechaInicio: "2026-06-11",
          fechaTermino: "2026-06-11",
        },
        { channel: "venta:buscar" },
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "TECHNICAL_ERROR",
        controllerId: "sales-history",
        message: "No fue posible consultar las ventas.",
      },
    });
    expect(consoleError).toHaveBeenCalledWith(error);

    consoleError.mockRestore();
  });
});

function toQuery(query: SQL): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(query);
}
