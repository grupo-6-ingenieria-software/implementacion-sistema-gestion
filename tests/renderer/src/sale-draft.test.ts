import { describe, expect, it } from "vitest";
import {
  SALE_DRAFT_STORAGE_KEY,
  SALE_DRAFT_VERSION,
  SALE_PENDING_USER_STORAGE_KEY,
  clearPendingSaleResume,
  clearSaleDraft,
  markSaleDraftForResume,
  readPendingSaleUserId,
  readSaleDraft,
  writeSaleDraft,
  type SaleDraft,
} from "../../../src/renderer/src/sale-draft";

describe("CU43 sale draft storage", () => {
  it("round-trips the full versioned sale draft", () => {
    const storage = createStorage();
    const draft: SaleDraft = {
      version: SALE_DRAFT_VERSION,
      usuarioId: "12345678-9",
      cart: [
        {
          productoId: 1,
          ean13: "7802920000015",
          nombre: "Leche",
          categoria: "Lácteos",
          precioVenta: 1200,
          stockDisponible: 8,
          cantidad: 2,
        },
      ],
      metodoPago: "efectivo",
      montoRecibido: "3.000",
      descuento: { monto: 200, razon: "Promoción" },
    };

    writeSaleDraft(draft, storage);

    expect(readSaleDraft(storage)).toEqual(draft);
    clearSaleDraft(storage);
    expect(readSaleDraft(storage)).toBeNull();
  });

  it.each([
    "not-json",
    JSON.stringify({ version: 0 }),
    JSON.stringify({
      version: SALE_DRAFT_VERSION,
      usuarioId: "12345678-9",
      cart: [],
      metodoPago: "efectivo",
      montoRecibido: "",
      descuento: null,
    }),
  ])("drops corrupted or incompatible storage: %s", (raw) => {
    const storage = createStorage();
    storage.setItem(SALE_DRAFT_STORAGE_KEY, raw);

    expect(readSaleDraft(storage)).toBeNull();
    expect(storage.getItem(SALE_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("stores and clears the pending same-user return independently", () => {
    const storage = createStorage();
    markSaleDraftForResume("12345678-9", storage);
    expect(readPendingSaleUserId(storage)).toBe("12345678-9");
    expect(storage.getItem(SALE_PENDING_USER_STORAGE_KEY)).toBe("12345678-9");

    clearPendingSaleResume(storage);
    expect(readPendingSaleUserId(storage)).toBeNull();
  });
});

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}
