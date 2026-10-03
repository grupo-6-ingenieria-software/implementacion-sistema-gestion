import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportFileStore } from "../../../src/main/controllers/report-export-file";
import { createReportExportHandler } from "../../../src/main/controllers/report-export-service";
import { createMonthlySalesReportAdapter, createReportRegistry } from "../../../src/main/controllers/report-registry";
import { context, report, reportDependencies, request, user } from "./report-export-fixture";
import { REPORT_RECONCILE_CHANNEL } from "../../../src/shared/reports";

let directory: string;
const filename = "VentasMensuales_2026-09_30-09-2026.pdf";
beforeEach(async () => { directory = await fs.mkdtemp(join(tmpdir(), "cu54-file-")); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

describe("CU54 filesystem failures preserve preexisting files", () => {
  it.each(["open", "write", "close", "backup", "publish"])("reverts %s failure and cleans only its own artifacts", async (fault) => {
    const path = join(directory, filename); await fs.writeFile(path, "original");
    const operations = { ...fs,
      open: async (...args: Parameters<typeof fs.open>) => {
        const isDataTemporary = String(args[0]).endsWith(".tmp") && !String(args[0]).includes(".json.");
        if (isDataTemporary && fault === "open") throw new Error("open failure");
        const handle = await fs.open(...args);
        if (!isDataTemporary) return handle;
        return new Proxy(handle, { get(target, key) {
          if (key === "writeFile" && fault === "write") return async () => { await target.writeFile("partial"); throw new Error("write failure"); };
          if (key === "close" && fault === "close") return async () => { await target.close(); throw new Error("close failure"); };
          const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
      },
      rename: async (...args: Parameters<typeof fs.rename>) => {
        if (String(args[1]).endsWith(".bak") && fault === "backup") throw new Error("backup failure");
        return fs.rename(...args);
      },
      link: async (...args: Parameters<typeof fs.link>) => {
        if (String(args[0]).endsWith(".tmp") && fault === "publish") throw new Error("publish failure");
        return fs.link(...args);
      },
    };
    const deps = reportDependencies(directory, { files: new ReportFileStore(join(directory, "evidence"), operations) });
    expect(await createReportExportHandler(deps)(request, context)).toMatchObject({ ok: false, error: { code: "TECHNICAL_ERROR", message: "No fue posible generar el archivo" } });
    expect(await fs.readFile(path, "utf8")).toBe("original");
    expect((await fs.readdir(directory)).filter((name) => /\.(tmp|bak)$/.test(name))).toEqual([]);
    expect(await fs.readdir(join(directory, "evidence"))).toEqual([]);
  });
  it.each(["pdf", "xlsx", "empty"])("handles %s generation failure before filesystem or audit", async (fault) => {
    const fail = async () => { if (fault === "empty") return Buffer.alloc(0); throw new Error("generation failure"); };
    const deps = reportDependencies(directory, { registry: createReportRegistry([createMonthlySalesReportAdapter(async () => ({ report, user }), fail, fail)]) });
    const finalize = vi.spyOn(deps.audit, "finalize");
    expect(await createReportExportHandler(deps)(request, { ...context, channel: fault === "xlsx" ? "reporte:exportar-xlsx" : context.channel }))
      .toMatchObject({ ok: false, error: { message: "No fue posible generar el archivo" } });
    expect(finalize).not.toHaveBeenCalled(); expect(await fs.readdir(directory)).toEqual([]);
  });
  it("detects a changed destination after overwrite confirmation and keeps the external file", async () => {
    const path = join(directory, filename); await fs.writeFile(path, "original");
    const deps = reportDependencies(directory, { confirmOverwrite: async () => { await fs.writeFile(path, "external"); return true; } });
    const finalize = vi.spyOn(deps.audit, "finalize");
    expect(await createReportExportHandler(deps)(request, context)).toMatchObject({ ok: false });
    expect(await fs.readFile(path, "utf8")).toBe("external"); expect(finalize).not.toHaveBeenCalled();
    expect(await fs.readdir(join(directory, "evidence"))).toEqual([]);
  });
  it("refuses a directory as the final file", async () => {
    await fs.mkdir(join(directory, filename));
    expect(await createReportExportHandler(reportDependencies(directory))(request, context)).toMatchObject({ ok: false });
    expect((await fs.lstat(join(directory, filename))).isDirectory()).toBe(true);
  });
  it("does not turn confirmed export into E1 when backup cleanup fails", async () => {
    const path = join(directory, filename); await fs.writeFile(path, "original"); const log = vi.fn();
    const operations = { ...fs, unlink: async (...args: Parameters<typeof fs.unlink>) => {
      if (String(args[0]).endsWith(".bak")) throw new Error("locked backup");
      return fs.unlink(...args);
    } };
    const deps = reportDependencies(directory, { files: new ReportFileStore(join(directory, "evidence"), operations, log) });
    expect(await createReportExportHandler(deps)(request, context)).toMatchObject({ ok: true, data: { estado: "saved" } });
    expect(await fs.readFile(path, "utf8")).toBe("pdf"); expect(log).toHaveBeenCalled();
    expect((await fs.readdir(join(directory, "evidence"))).filter((name) => name.endsWith(".json"))).toHaveLength(1);
  });
  it("keeps evidence and the original backup when restoration fails, then restores explicitly", async () => {
    const path = join(directory, filename); await fs.writeFile(path, "original");
    const operations = { ...fs, link: async (...args: Parameters<typeof fs.link>) => {
      if (String(args[0]).endsWith(".bak")) throw new Error("restore blocked");
      return fs.link(...args);
    } };
    const deps = reportDependencies(directory, { files: new ReportFileStore(join(directory, "evidence"), operations),
      audit: { finalize: async (_op, publish) => { await publish(); throw new Error("known rollback"); }, confirmed: async () => false },
    });
    const result = await createReportExportHandler(deps)(request, context);
    expect(result).toMatchObject({ ok: false, error: { code: "EXPORT_RECONCILIATION_REQUIRED" } });
    if (result.ok) throw new Error("Expected pending");
    const operation = (await deps.files.find(result.error.operacionId!))!;
    expect(await fs.readFile(operation.backupPath, "utf8")).toBe("original");
    await expect(fs.lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    deps.files = new ReportFileStore(join(directory, "evidence"));
    expect(await createReportExportHandler(deps)({ operacionId: operation.operacionId }, { ...context, channel: REPORT_RECONCILE_CHANNEL }))
      .toMatchObject({ ok: true, data: { estado: "reverted" } });
    expect(await fs.readFile(path, "utf8")).toBe("original");
    expect(await fs.readdir(join(directory, "evidence"))).toEqual([]);
  });
});

describe("CU54 publishes on filesystems without hard links (FAT32/exFAT)", () => {
  const unsupported = (code: string) => Object.assign(new Error("hard links unsupported"), { code });
  const listAuxiliary = async () => (await fs.readdir(directory)).filter((name) => /\.(tmp|bak)$/.test(name));
  it.each([["ENOTSUP", true], ["EPERM", false], ["EISDIR", true]] as const)("copies exclusively on %s (previous file: %s)", async (code, previous) => {
    const path = join(directory, filename); if (previous) await fs.writeFile(path, "original");
    const operations = { ...fs, link: async () => { throw unsupported(code); } };
    const deps = reportDependencies(directory, { files: new ReportFileStore(join(directory, "evidence"), operations) });
    expect(await createReportExportHandler(deps)(request, context)).toMatchObject({ ok: true, data: { estado: "saved" } });
    expect(await fs.readFile(path, "utf8")).toBe("pdf");
    expect(await listAuxiliary()).toEqual([]);
    expect(await fs.readdir(join(directory, "evidence"))).toEqual([]);
  });
  it("keeps a file created by another process instead of overwriting it", async () => {
    const path = join(directory, filename);
    const operations = { ...fs, link: async (...args: Parameters<typeof fs.link>) => {
      if (String(args[0]).endsWith(".tmp")) await fs.writeFile(args[1], "external");
      throw unsupported("ENOTSUP");
    } };
    const deps = reportDependencies(directory, { files: new ReportFileStore(join(directory, "evidence"), operations) });
    expect(await createReportExportHandler(deps)(request, context)).toMatchObject({ ok: false });
    expect(await fs.readFile(path, "utf8")).toBe("external");
  });
  it("removes its partial copy and restores the previous file when copying fails", async () => {
    const path = join(directory, filename); await fs.writeFile(path, "original");
    const operations = { ...fs,
      link: async (...args: Parameters<typeof fs.link>) => {
        if (String(args[0]).endsWith(".tmp")) throw unsupported("ENOTSUP");
        return fs.link(...args);
      },
      open: async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args);
        if (basename(String(args[0])) !== filename) return handle;
        return new Proxy(handle, { get(target, key) {
          if (key === "writeFile") return async () => { await target.writeFile("partial"); throw new Error("disk full"); };
          const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
      },
    };
    const deps = reportDependencies(directory, { files: new ReportFileStore(join(directory, "evidence"), operations) });
    expect(await createReportExportHandler(deps)(request, context)).toMatchObject({ ok: false, error: { code: "TECHNICAL_ERROR", message: "No fue posible generar el archivo" } });
    expect(await fs.readFile(path, "utf8")).toBe("original");
    expect(await listAuxiliary()).toEqual([]);
    expect(await fs.readdir(join(directory, "evidence"))).toEqual([]);
  });
});
