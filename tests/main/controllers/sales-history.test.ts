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

describe("CU38 sale lookup and detail", () => {
  it("finds a current valid sale using Chilean day boundaries", async () => {
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

  it("distinguishes invalid, missing, previous-day and annulled sales", async () => {
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

  it("builds detail from historical prices, discount, cash and state", async () => {
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
        responsable: { usuarioId: "usuario-1", nombre: "Maria Huascar" },
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

describe("CU41 sales history search", () => {
  it("uses an inclusive Chilean range and maps historical totals and eligibility", async () => {
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

  it("searches a full UUID exactly without a date restriction", async () => {
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
  ])("rejects invalid direct requests before querying: $criterio", async (payload) => {
    await expect(
      searchSalesHistory(database, payload as never),
    ).rejects.toBeInstanceOf(SaleHistoryValidationError);
    expect(allMock).not.toHaveBeenCalled();
  });
});

describe("daily sales history query", () => {
  it("uses Chile winter boundaries and orders newest sales first", async () => {
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

  it("uses Chile summer boundaries", async () => {
    allMock.mockResolvedValueOnce([]);

    await loadDailySalesHistory(database, new Date("2026-01-15T12:00:00Z"));

    expect(toQuery(allMock.mock.calls[0][0]).params).toEqual([
      "2026-01-15 03:00:00",
      "2026-01-16 03:00:00",
    ]);
  });

  it("maps sales and excludes voided sales from current totals", async () => {
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
        },
        {
          ventaId: "venta-2",
          fechaHora: "2026-06-11T17:00:00.000Z",
          metodoPago: "efectivo",
          estado: "anulada",
          discountType: "porcentaje",
          discountValue: "10",
          usuarioId: "u-2",
        },
        {
          ventaId: "venta-1",
          fechaHora: "2026-06-11T15:00:00.000Z",
          metodoPago: "efectivo",
          estado: "completada",
          discountType: "ninguno",
          discountValue: null,
          usuarioId: "u-1",
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
      .mockResolvedValueOnce([
        { usuarioId: "u-1", trabajadorId: 1 },
        { usuarioId: "u-2", trabajadorId: 2 },
      ])
      .mockResolvedValueOnce([
        { trabajadorId: 1, nombre: "Maria Huascar" },
        { trabajadorId: 2, nombre: "Luis Soto" },
      ])
      .mockResolvedValueOnce([{ ventaId: "venta-2" }]);

    await expect(
      loadDailySalesHistory(database, new Date("2026-06-11T12:00:00Z")),
    ).resolves.toEqual({
      ventas: [
        {
          ventaId: "venta-3",
          fechaHora: "2026-06-11T18:30:00.000Z",
          trabajadorResponsable: "Maria Huascar",
          cantidadProductos: 3,
          total: 4500,
          metodoPago: "debito",
          estado: "confirmada",
        },
        {
          ventaId: "venta-2",
          fechaHora: "2026-06-11T17:00:00.000Z",
          trabajadorResponsable: "Luis Soto",
          cantidadProductos: 2,
          total: 9000,
          metodoPago: "efectivo",
          estado: "anulada",
        },
        {
          ventaId: "venta-1",
          fechaHora: "2026-06-11T15:00:00.000Z",
          trabajadorResponsable: "Maria Huascar",
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

  it("returns an empty list and zeroed summary when the day has no sales", async () => {
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

describe("sales history controller", () => {
  it("routes CU41 searches without changing the legacy CU38 request shape", async () => {
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

  it("maps invalid CU41 filters to a public validation error", async () => {
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

  it("returns a technical error without exposing database details", async () => {
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

  it("returns a generic technical error for CU41 searches", async () => {
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
