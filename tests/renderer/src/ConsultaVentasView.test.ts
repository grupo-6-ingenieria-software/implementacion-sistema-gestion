import { describe, expect, it } from "vitest";
import {
  buildSaleAnnulmentPath,
  buildSaleHistoryPath,
  getSafeSalesQueryReturnPath,
  parseSaleHistoryRoute,
  validateSearch,
} from "../../../src/renderer/src/views/ConsultaVentasView";

const saleId = "00000000-0000-4000-8000-000000000401";

describe("CU41 route and filter helpers", () => {
  it("validates both exclusive search modes", () => {
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

  it("reports invalid dates and UUIDs next to their fields", () => {
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

  it("round-trips applied filters and the selected detail in the URL", () => {
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

  it("rejects invalid or external return paths", () => {
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
