import { describe, expect, it } from "vitest";
import { defaultAuditLogPageSize } from "../../../../src/shared/audit";
import {
  buildAuditLogQueryPayload,
  formatDateTime,
  type AuditLogFilters,
} from "../../../../src/renderer/src/views/AuditLogView";

describe("helpers de AuditLogView", () => {
  it("construye un payload de consulta compacto a partir de los filtros visibles", () => {
    const filters: AuditLogFilters = {
      fechaDesde: "2026-06-01",
      fechaHasta: "",
      tipoAccion: "registro",
      usuarioFiltroId: "",
    };

    expect(buildAuditLogQueryPayload("12345678-9", filters, 2)).toEqual({
      fechaDesde: "2026-06-01",
      fechaHasta: undefined,
      page: 2,
      pageSize: defaultAuditLogPageSize,
      tipoAccion: "registro",
      usuarioFiltroId: undefined,
      usuarioId: "12345678-9",
    });
  });

  it("formatea las marcas de tiempo de auditoría sin lanzar excepciones durante el renderizado de la tabla", () => {
    expect(() => formatDateTime("2026-06-13T00:58:41.932Z")).not.toThrow();
    expect(formatDateTime("fecha sin formato")).toBe("fecha sin formato");
  });
});
