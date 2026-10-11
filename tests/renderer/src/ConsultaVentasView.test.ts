import { describe, expect, it } from "vitest";
import {
  buildSaleAnnulmentPath,
  buildSaleHistoryPath,
  getSafeSalesQueryReturnPath,
  parseSaleHistoryRoute,
  validateSearch,
} from "../../../src/renderer/src/views/ConsultaVentasView";

const saleId = "00000000-0000-4000-8000-000000000401";

describe("helpers de ruta y filtros de CU41", () => {
  it("valida ambos modos de búsqueda excluyentes", () => {
    expect(validateSearch("rango", "2026-09-10", "2026-09-11", "")).toEqual({
      request: {
        criterio: "rango",
        fechaInicio: "2026-09-10",
        fechaTermino: "2026-09-11",
      },
      errors: {},
    });
    expect(validateSearch("numero", "", "", ` ${saleId} `)).toEqual({
      request: { criterio: "numero", ventaId: saleId },
      errors: {},
    });
  });

  it("informa fechas y UUID inválidos junto a sus campos", () => {
    expect(
      validateSearch("rango", "2026-09-12", "2026-09-11", "").errors,
    ).toHaveProperty("fechaTermino");
    expect(validateSearch("rango", "2026-02-29", "", "").errors).toEqual({
      fechaInicio: "Ingrese una fecha de inicio válida.",
      fechaTermino: "Ingrese una fecha de término válida.",
    });
    expect(validateSearch("numero", "", "", "venta-1").errors).toHaveProperty(
      "ventaId",
    );
  });

  it("serializa y recupera en la URL los filtros aplicados y el detalle seleccionado", () => {
    const request = {
      criterio: "rango" as const,
      fechaInicio: "2026-09-10",
      fechaTermino: "2026-09-11",
    };
    const path = buildSaleHistoryPath(request, saleId);

    expect(parseSaleHistoryRoute(path)).toEqual({
      request,
      selectedSaleId: saleId,
    });

    const annulmentPath = buildSaleAnnulmentPath(saleId, path);
    expect(getSafeSalesQueryReturnPath(annulmentPath)).toBe(path);
  });

  it("rechaza rutas de retorno inválidas o externas", () => {
    expect(
      getSafeSalesQueryReturnPath(
        `/app/ventas/anular?ventaId=${saleId}&returnTo=${encodeURIComponent("https://example.com")}`,
      ),
    ).toBeUndefined();
    expect(
      getSafeSalesQueryReturnPath(
        `/app/ventas/anular?ventaId=${saleId}&returnTo=${encodeURIComponent("/app/ventas/consulta?criterio=numero&numero=invalido")}`,
      ),
    ).toBeUndefined();
  });
});
