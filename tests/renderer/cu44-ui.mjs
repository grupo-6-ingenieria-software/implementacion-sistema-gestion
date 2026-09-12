import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const rootUrl = server.resolvedUrls?.local[0];
  assert.ok(rootUrl);

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await installBridge(page);
  await page.goto(`${rootUrl}tests/renderer/cu44-harness.html`);
  const salesCard = page.locator("article").filter({ hasText: "Ventas del dia" });

  await salesCard.getByText("$12.000", { exact: true }).waitFor();
  await salesCard
    .getByText("2 transacciones vigentes", { exact: true })
    .waitFor();
  await salesCard.getByText("1 anuladas", { exact: true }).waitFor();
  await salesCard.getByText("($4.500)", { exact: true }).waitFor();

  await page.evaluate(() => {
    window.dashboardMode = "updated";
    window.emitDashboardUpdated();
  });
  await salesCard.getByText("$15.000", { exact: true }).waitFor();
  assert.equal(await salesCard.getByText("$12.000", { exact: true }).count(), 0);

  await page.evaluate(() => {
    window.dashboardMode = "failure";
    window.emitDashboardUpdated();
  });
  const refreshError = page.getByRole("status");
  await refreshError.getByText("Actualización simulada fallida", { exact: true }).waitFor();
  await refreshError
    .getByText("Se mantienen los últimos valores válidos.", { exact: true })
    .waitFor();
  await salesCard.getByText("$15.000", { exact: true }).waitFor();

  await page.evaluate(() => {
    window.dashboardMode = "recovered";
  });
  await refreshError.getByRole("button", { name: "Reintentar" }).click();
  await salesCard.getByText("$18.000", { exact: true }).waitFor();
  assert.equal(await page.getByRole("status").count(), 0);

  await page.evaluate(() => {
    window.dashboardMode = "concurrent";
    window.emitDashboardUpdated();
    window.emitDashboardUpdated();
  });
  await page.getByText("Actualizando indicadores...", { exact: true }).waitFor();
  await page.waitForFunction(() => window.pendingDashboardRequests.length === 2);

  await page.evaluate(() => {
    window.resolveDashboardRequest(1, 22_000, "2026-09-12T16:00:00.000Z");
  });
  await salesCard.getByText("$22.000", { exact: true }).waitFor();

  await page.evaluate(() => {
    window.resolveDashboardRequest(0, 19_000, "2026-09-12T15:50:00.000Z");
  });
  await page.waitForTimeout(100);
  await salesCard.getByText("$22.000", { exact: true }).waitFor();
  assert.equal(await salesCard.getByText("$19.000", { exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.pageErrors), []);

  console.log(
    "PASS CU44: carga CLP, actualización automática, conservación y reintento, y descarte de respuestas antiguas",
  );
} finally {
  await browser?.close();
  await server.close();
}

async function installBridge(page) {
  await page.addInitScript(() => {
    const listeners = new Set();
    window.pageErrors = [];
    window.dashboardMode = "initial";
    window.pendingDashboardRequests = [];
    window.addEventListener("error", (event) =>
      window.pageErrors.push(event.error?.message ?? event.message),
    );

    window.makeDashboard = (amount, generatedAt) => ({
      generatedAt,
      sales: {
        currentAmount: amount,
        currentTransactions: 2,
        voidedAmount: 4_500,
        voidedTransactions: 1,
      },
      cashSummary: {
        status: "abierta",
        currentAmount: amount,
        currentTransactions: 2,
        voidedAmount: 4_500,
        voidedTransactions: 1,
        byPaymentMethod: {
          efectivo: {
            currentAmount: amount,
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
        activeWorkers: 0,
        workersWithAttendance: 0,
        workersWithoutAttendance: 0,
        pendingWorkers: [],
      },
    });

    window.emitDashboardUpdated = () => {
      for (const listener of listeners) listener();
    };
    window.resolveDashboardRequest = (index, amount, generatedAt) => {
      window.pendingDashboardRequests[index]({
        ok: true,
        data: window.makeDashboard(amount, generatedAt),
      });
    };

    window.appApi = {
      onDashboardUpdated: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      invoke: async (channel) => {
        if (channel !== "dashboard:cargar") {
          throw new Error(`Canal inesperado: ${channel}`);
        }

        if (window.dashboardMode === "failure") {
          return {
            ok: false,
            error: {
              code: "TECHNICAL_ERROR",
              message: "Actualización simulada fallida",
            },
          };
        }
        if (window.dashboardMode === "concurrent") {
          return new Promise((resolve) => {
            window.pendingDashboardRequests.push(resolve);
          });
        }

        const fixtures = {
          initial: [12_000, "2026-09-12T15:30:00.000Z"],
          updated: [15_000, "2026-09-12T15:40:00.000Z"],
          recovered: [18_000, "2026-09-12T15:45:00.000Z"],
        };
        const [amount, generatedAt] = fixtures[window.dashboardMode];
        return {
          ok: true,
          data: window.makeDashboard(amount, generatedAt),
        };
      },
    };
  });
}
