import { describe, expect, it } from "vitest";
import {
  normalizeRestockListRequest,
  RESTOCK_EMPTY_MESSAGE,
  RESTOCK_EXPORT_ERROR_MESSAGE,
} from "../../src/shared/restock";

describe("contrato compartido de reposición CU16", () => {
  it("acepta solo la identidad autenticada opcional", () => {
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

  it("mantiene los mensajes especificados para estado vacío y fallo de exportación", () => {
    expect(RESTOCK_EMPTY_MESSAGE).toBe(
      "No hay productos que requieran reabastecimiento",
    );
    expect(RESTOCK_EXPORT_ERROR_MESSAGE).toBe(
      "No fue posible generar el archivo. Intente nuevamente",
    );
  });
});
