import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DashboardData } from "../../../../src/shared/dashboard";
import { ResumenVentasDashboard } from "../../../../src/renderer/src/components/ResumenVentasDashboard";
import {
  DashboardRefreshError,
  getDashboardFailureState,
  getDashboardLoadingState,
  isLatestDashboardRequest,
  type DashboardState,
} from "../../../../src/renderer/src/views/DashboardView";

const dashboardData: DashboardData = {
  generatedAt: "2026-09-12T15:30:00.000Z",
  sales: {
    currentAmount: 12_000,
    currentTransactions: 2,
    voidedAmount: 4_500,
    voidedTransactions: 1,
  },
  cashSummary: {
    status: "abierta",
    currentAmount: 12_000,
    currentTransactions: 2,
    voidedAmount: 4_500,
    voidedTransactions: 1,
    byPaymentMethod: {
      efectivo: {
        currentAmount: 12_000,
        currentTransactions: 2,
        voidedAmount: 4_500,
        voidedTransactions: 1,
      },
      debito: {
        currentAmount: 0,
        currentTransactions: 0,
        voidedAmount: 0,
        voidedTransactions: 0,
      },
      credito: {
        currentAmount: 0,
        currentTransactions: 0,
        voidedAmount: 0,
        voidedTransactions: 0,
      },
      transferencia: {
        currentAmount: 0,
        currentTransactions: 0,
        voidedAmount: 0,
        voidedTransactions: 0,
      },
    },
  },
  stockAlerts: [],
  expirationAlerts: { expired: [], expiringSoon: [] },
  attendance: {
    scope: "global",
    activeWorkers: 0,
    workersWithAttendance: 0,
    workersWithoutAttendance: 0,
    pendingWorkers: [],
  },
};

const readyState: DashboardState = {
  status: "ready",
  data: dashboardData,
  isRefreshing: false,
};

describe("estados de actualización de DashboardView CU44", () => {
  it("mantiene visibles los últimos datos válidos mientras se actualiza", () => {
    const next = getDashboardLoadingState(readyState, true);

    expect(next).toMatchObject({ status: "ready", isRefreshing: true });
    expect(next.status === "ready" && next.data).toBe(dashboardData);
  });

  it("mantiene exactamente los mismos datos y expone reintento tras un fallo de actualización", () => {
    const next = getDashboardFailureState(
      readyState,
      "No fue posible actualizar.",
      true,
    );

    expect(next).toMatchObject({
      status: "ready",
      isRefreshing: false,
      refreshError: "No fue posible actualizar.",
    });
    expect(next.status === "ready" && next.data).toBe(dashboardData);

    const markup = renderToStaticMarkup(
      createElement(DashboardRefreshError, {
        message: "No fue posible actualizar.",
        onRetry: vi.fn(),
      }),
    );
    expect(markup).toContain("Se mantienen los últimos valores válidos.");
    expect(markup).toContain("Reintentar");
  });

  it("usa un estado de error completo solo cuando no hay valores válidos que conservar", () => {
    expect(
      getDashboardFailureState(
        { status: "loading" },
        "No fue posible cargar.",
        true,
      ),
    ).toEqual({ status: "error", message: "No fue posible cargar." });
  });

  it("acepta solo la solicitud concurrente más reciente", () => {
    expect(isLatestDashboardRequest(1, 2)).toBe(false);
    expect(isLatestDashboardRequest(2, 2)).toBe(true);
  });
});

describe("ResumenVentasDashboard CU44", () => {
  it("formatea los totales vigentes y anulados en CLP", () => {
    const markup = renderToStaticMarkup(
      createElement(ResumenVentasDashboard, {
        total: 12_000,
        transacciones: 2,
        montoAnulado: 4_500,
        transaccionesAnuladas: 1,
      }),
    );

    expect(markup).toContain("$12.000");
    expect(markup).toContain("2 transacciones vigentes");
    expect(markup).toContain("1 anuladas");
    expect(markup).toContain("$4.500");
  });

  it("muestra el estado cero documentado sin bloque de anulación", () => {
    const markup = renderToStaticMarkup(
      createElement(ResumenVentasDashboard, {
        total: 0,
        transacciones: 0,
        montoAnulado: 0,
        transaccionesAnuladas: 0,
      }),
    );

    expect(markup).toContain("$0");
    expect(markup).toContain("0 transacciones vigentes");
    expect(markup).not.toContain("anuladas");
  });
});
