import { describe, expect, it } from "vitest";
import { controllers, ipcChannels } from "../../src/shared/controllers";
import { registeredControllers } from "../../src/main/controllers";

describe("controller registry", () => {
  it("declares one metadata entry per controller id", () => {
    const ids = controllers.map((controller) => controller.id);

    expect(controllers).toHaveLength(29);
    expect(new Set(ids)).toHaveProperty("size", 29);
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
      "product-detail",
      "stock-adjustment",
      "movement-history",
    ]);
  });

  it("registers the same controllers in the main process", () => {
    expect(
      registeredControllers.map((controller) => controller.metadata.id),
    ).toEqual(controllers.map((controller) => controller.id));
  });

  it("assigns at least one IPC channel to every controller", () => {
    expect(ipcChannels.length).toBeGreaterThanOrEqual(29);
    expect(
      controllers.every((controller) => controller.channels.length > 0),
    ).toBe(true);
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
