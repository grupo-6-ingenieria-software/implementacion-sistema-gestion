import { describe, expect, it } from "vitest";
import {
  normalizeRestockListRequest,
  RESTOCK_EMPTY_MESSAGE,
  RESTOCK_EXPORT_ERROR_MESSAGE,
} from "../../src/shared/restock";

describe("CU16 shared restock contract", () => {
  it("accepts only the optional authenticated identity", () => {
    expect(
      normalizeRestockListRequest({
        usuarioId: " owner ",
        filas: [{ nombre: "Manipulado" }],
        ruta: "C:/otro.pdf",
        encabezados: ["Otro"],
      }),
    ).toEqual({ usuarioId: "owner" });
    expect(normalizeRestockListRequest(null)).toEqual({});
  });

  it("keeps the specified empty and export failure messages", () => {
    expect(RESTOCK_EMPTY_MESSAGE).toBe(
      "No hay productos que requieran reabastecimiento",
    );
    expect(RESTOCK_EXPORT_ERROR_MESSAGE).toBe(
      "No fue posible generar el archivo. Intente nuevamente",
    );
  });
});
