import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { isReportOperationId, type ReportExportRequest, type ReportExportResult } from "../../shared/reports";

type FileOperations = {
  link: typeof link; lstat: typeof lstat; mkdir: typeof mkdir; open: typeof open;
  readFile: typeof readFile; readdir: typeof readdir; realpath: typeof realpath;
  rename: typeof rename; unlink: typeof unlink;
};
const fileOperations: FileOperations = { link, lstat, mkdir, open, readFile, readdir, realpath, rename, unlink };
export type ReportDestination = { path: string; originalHash: string | null };
export type ReportFileOperation = {
  version: 1;
  processId: number;
  operacionId: string;
  path: string;
  temporaryPath: string;
  backupPath: string;
  originalHash: string | null;
  contentsHash: string;
  request: ReportExportRequest;
  usuarioId: string;
  auditFechaHora: string;
  auditDescripcion: string;
  result: ReportExportResult;
  stage: "prepared" | "published" | "confirmed" | "reverted";
};
export type ReportFileMetadata = Pick<ReportFileOperation,
  "operacionId" | "request" | "usuarioId" | "auditFechaHora" | "auditDescripcion" | "result">;

export class ReportPendingError extends Error {
  constructor(readonly operacionId: string) { super("ReportExportPending"); }
}
export class ReportDestinationChangedError extends Error {
  constructor() { super("ReportDestinationChanged"); }
}

function missing(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
// FAT32/exFAT and some network shares reject hard links (ENOTSUP on macOS, EPERM on
// Linux; libuv maps Windows ERROR_INVALID_FUNCTION to EISDIR).
const unsupportedLinkCodes = new Set(["ENOTSUP", "EOPNOTSUPP", "EPERM", "EISDIR", "ENOSYS", "EXDEV"]);
function linkUnsupported(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && unsupportedLinkCodes.has(String(error.code));
}
function digest(contents: Buffer | string): string {
  return createHash("sha256").update(contents).digest("hex");
}
function targetKey(path: string): string {
  return digest(process.platform === "win32" ? path.toLowerCase() : path);
}
function auxiliaryPaths(path: string, id: string) {
  const prefix = join(dirname(path), `.${basename(path)}.cu54-${id}`);
  return { temporaryPath: `${prefix}.tmp`, backupPath: `${prefix}.bak` };
}
function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    // Permission failures are not evidence that the owning process has ended.
    return !error || typeof error !== "object" || !("code" in error) || error.code !== "ESRCH";
  }
}

/** Private, durable evidence is separate from the immutable business audit. */
export class ReportFileStore {
  private readonly active = new Set<string>();
  private readonly verifications = new Map<string, string>();
  constructor(
    readonly evidenceDirectory: string,
    private readonly fs: FileOperations = fileOperations,
    private readonly logCleanup: (error: unknown) => void = () => undefined,
  ) {}

  private reportCleanup(error: unknown): void {
    try { this.logCleanup(error); } catch { /* diagnostics do not change a confirmed outcome */ }
  }
  private markerPath(path: string): string { return join(this.evidenceDirectory, `${targetKey(path)}.json`); }

  private async verificationActive(path: string, ownLease?: string): Promise<boolean> {
    const prefix = `${basename(this.markerPath(path))}.verify-`;
    const names = await this.fs.readdir(this.evidenceDirectory);
    for (const name of names) {
      if (!name.startsWith(prefix) || join(this.evidenceDirectory, name) === ownLease) continue;
      const suffix = name.slice(prefix.length);
      const separator = suffix.indexOf("-");
      const pid = Number(suffix.slice(0, separator));
      if (separator <= 0 || !Number.isInteger(pid) || pid <= 0 || !isReportOperationId(suffix.slice(separator + 1)))
        throw new Error("InvalidReportVerificationLease");
      // Each process owns a unique lease. A dead process's lease cannot block
      // explicit recovery after restart; no foreign lease needs to be deleted.
      if (processAlive(pid)) return true;
    }
    return false;
  }

  private async hash(path: string): Promise<string | null> {
    try {
      const info = await this.fs.lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("InvalidReportFile");
      return digest(await this.fs.readFile(path));
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  async inspect(directory: string, filename: string): Promise<ReportDestination> {
    if (!filename || basename(filename) !== filename || /[<>:"/\\|?*\u0000-\u001f]/.test(filename))
      throw new Error("InvalidReportFilename");
    const folder = await this.fs.realpath(resolve(directory));
    if (!(await this.fs.lstat(folder)).isDirectory()) throw new Error("InvalidReportDirectory");
    const path = join(folder, filename);
    return { path, originalHash: await this.hash(path) };
  }

  private validate(value: unknown, markerPath: string): ReportFileOperation {
    const op = value as ReportFileOperation | null;
    if (!op || op.version !== 1 || !Number.isInteger(op.processId) || op.processId <= 0 || !isReportOperationId(op.operacionId) ||
      typeof op.path !== "string" || !isAbsolute(op.path) || resolve(op.path) !== op.path ||
      markerPath !== this.markerPath(op.path) || !validHash(op.contentsHash) ||
      !(op.originalHash === null || validHash(op.originalHash)) ||
      typeof op.usuarioId !== "string" || !op.usuarioId || typeof op.auditDescripcion !== "string" ||
      typeof op.auditFechaHora !== "string" || !Number.isFinite(Date.parse(op.auditFechaHora)) ||
      !op.request || typeof op.request.tipo !== "string" || !Object.hasOwn(op.request, "periodo") ||
      !op.result || op.result.estado !== "saved" || op.result.ruta !== op.path ||
      !["pdf", "xlsx"].includes(op.result.formato) || !Number.isInteger(op.result.cantidadFilas) || op.result.cantidadFilas < 0 ||
      !Number.isFinite(Date.parse(op.result.fechaGeneracion)) ||
      !["prepared", "published", "confirmed", "reverted"].includes(op.stage)) throw new Error("InvalidReportEvidence");
    const expected = auxiliaryPaths(op.path, op.operacionId);
    if (op.temporaryPath !== expected.temporaryPath || op.backupPath !== expected.backupPath)
      throw new Error("InvalidReportEvidencePaths");
    return op;
  }

  async pendingAt(path: string): Promise<ReportFileOperation | null> {
    const marker = this.markerPath(path);
    try {
      return this.validate(JSON.parse(await this.fs.readFile(marker, "utf8")), marker);
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  async find(id: string): Promise<ReportFileOperation | null> {
    if (!isReportOperationId(id)) throw new RangeError("Operación de exportación no válida.");
    let names: string[];
    try { names = await this.fs.readdir(this.evidenceDirectory); }
    catch (error) { if (missing(error)) return null; throw error; }
    for (const name of names) {
      if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
      const marker = join(this.evidenceDirectory, name);
      try {
        const op = this.validate(JSON.parse(await this.fs.readFile(marker, "utf8")), marker);
        if (op.operacionId === id) return op;
      } catch (error) { this.reportCleanup(error); }
    }
    return null;
  }

  private async checkpoint(op: ReportFileOperation): Promise<void> {
    const marker = this.markerPath(op.path);
    const temporaryMarker = `${marker}.${op.operacionId}.tmp`;
    let created = false;
    try {
      const handle = await this.fs.open(temporaryMarker, "wx");
      created = true;
      try { await handle.writeFile(JSON.stringify(op)); await handle.sync(); }
      finally { await handle.close(); }
      await this.fs.rename(temporaryMarker, marker);
      created = false;
    } finally {
      if (created) await this.fs.unlink(temporaryMarker).catch((error) => this.reportCleanup(error));
    }
  }

  async stage(destination: ReportDestination, contents: Buffer, metadata: ReportFileMetadata): Promise<ReportFileOperation> {
    if (!contents.length) throw new Error("EmptyExportBuffer");
    const op: ReportFileOperation = {
      ...metadata, version: 1, processId: process.pid, path: destination.path, originalHash: destination.originalHash,
      contentsHash: digest(contents), ...auxiliaryPaths(destination.path, metadata.operacionId), stage: "prepared",
    };
    await this.fs.mkdir(this.evidenceDirectory, { recursive: true });
    const marker = this.markerPath(op.path);
    let markerCreated = false;
    let temporaryCreated = false;
    try {
      const handle = await this.fs.open(marker, "wx");
      markerCreated = true;
      this.active.add(op.operacionId);
      try { await handle.writeFile(JSON.stringify(op)); await handle.sync(); }
      finally { await handle.close(); }
      if (await this.verificationActive(op.path)) throw new Error("ReportVerificationInProgress");
      if (await this.hash(op.path) !== op.originalHash) throw new ReportDestinationChangedError();
      const temporary = await this.fs.open(op.temporaryPath, "wx");
      temporaryCreated = true;
      try { await temporary.writeFile(contents); await temporary.sync(); }
      finally { await temporary.close(); }
      return op;
    } catch (error) {
      this.active.delete(op.operacionId);
      if (!markerCreated) {
        const pending = await this.pendingAt(op.path);
        if (pending) throw new ReportPendingError(pending.operacionId);
        throw error;
      }
      try {
        // Only this invocation can clean its partially written, exclusively created temporary.
        if (temporaryCreated) await this.fs.unlink(op.temporaryPath);
        await this.fs.unlink(marker);
      } catch (cleanupError) {
        this.reportCleanup(cleanupError);
        throw new ReportPendingError(op.operacionId);
      }
      throw error;
    }
  }

  release(op: ReportFileOperation): void { this.active.delete(op.operacionId); }

  async beginVerification(op: ReportFileOperation): Promise<boolean> {
    if (this.active.has(op.operacionId)) return false;
    if (op.processId !== process.pid && processAlive(op.processId)) return false;
    this.active.add(op.operacionId);
    const lease = `${this.markerPath(op.path)}.verify-${process.pid}-${randomUUID()}`;
    try {
      const handle = await this.fs.open(lease, "wx");
      this.verifications.set(op.operacionId, lease);
      try { await handle.writeFile(op.operacionId); await handle.sync(); }
      finally { await handle.close(); }
      if (await this.verificationActive(op.path, lease)) {
        await this.endVerification(op);
        return false;
      }
      const current = await this.pendingAt(op.path);
      if (!current || current.operacionId !== op.operacionId) {
        await this.endVerification(op);
        return false;
      }
      return true;
    } catch (error) {
      this.reportCleanup(error);
      await this.endVerification(op);
      return false;
    }
  }

  async endVerification(op: ReportFileOperation): Promise<void> {
    const lease = this.verifications.get(op.operacionId);
    this.verifications.delete(op.operacionId);
    if (lease) await this.fs.unlink(lease).catch((error) => this.reportCleanup(error));
    this.active.delete(op.operacionId);
  }

  async publish(op: ReportFileOperation): Promise<void> {
    if (await this.hash(op.path) !== op.originalHash) throw new ReportDestinationChangedError();
    if (await this.hash(op.temporaryPath) !== op.contentsHash) throw new Error("InvalidReportTemporary");
    if (await this.hash(op.backupPath) !== null) throw new Error("ReportBackupAlreadyExists");
    if (op.originalHash !== null) {
      await this.fs.rename(op.path, op.backupPath);
      if (await this.hash(op.backupPath) !== op.originalHash) throw new ReportDestinationChangedError();
    }
    await this.place(op.temporaryPath, op.path);
    op.stage = "published";
    await this.checkpoint(op);
  }

  /** Places a complete file without clobbering a racing writer. */
  private async place(source: string, target: string): Promise<void> {
    try { return await this.fs.link(source, target); }
    catch (error) { if (!linkUnsupported(error)) throw error; }
    // Without hard links, an exclusive "wx" copy keeps the no-clobber guarantee.
    const contents = await this.fs.readFile(source);
    const handle = await this.fs.open(target, "wx");
    try {
      try { await handle.writeFile(contents); await handle.sync(); }
      finally { await handle.close(); }
    } catch (error) {
      // The exclusive target belongs to this invocation; never leave a partial copy.
      await this.fs.unlink(target).catch((cleanupError) => this.reportCleanup(cleanupError));
      throw error;
    }
  }

  private async removeMatching(path: string, expected: string | null): Promise<void> {
    const actual = await this.hash(path);
    if (actual === null) return;
    if (expected === null || actual !== expected) throw new Error("ReportArtifactChanged");
    await this.fs.unlink(path);
  }

  async revert(op: ReportFileOperation): Promise<void> {
    const current = await this.hash(op.path);
    const backup = await this.hash(op.backupPath);
    if (backup !== null) {
      if (backup !== op.originalHash) throw new Error("ReportBackupChanged");
      if (current === op.contentsHash) await this.fs.unlink(op.path);
      else if (current !== null && current !== op.originalHash) throw new ReportDestinationChangedError();
      if (await this.hash(op.path) === null) await this.place(op.backupPath, op.path);
      if (await this.hash(op.path) !== op.originalHash) throw new Error("ReportRestoreFailed");
      await this.removeMatching(op.backupPath, op.originalHash);
    } else if (op.originalHash === null) {
      await this.removeMatching(op.path, op.contentsHash);
    } else if (current !== op.originalHash) {
      throw new Error("ReportOriginalUnavailable");
    }
    await this.removeMatching(op.temporaryPath, op.contentsHash);
    op.stage = "reverted";
    await this.checkpoint(op);
    await this.fs.unlink(this.markerPath(op.path));
  }

  async matchesPublished(op: ReportFileOperation): Promise<boolean> {
    return await this.hash(op.path) === op.contentsHash;
  }

  async finish(op: ReportFileOperation): Promise<void> {
    if (!(await this.matchesPublished(op))) throw new Error("ReportPublishedFileChanged");
    op.stage = "confirmed";
    // Confirmed file + audit stay successful even if auxiliary cleanup fails.
    try {
      await this.checkpoint(op);
      await this.removeMatching(op.backupPath, op.originalHash);
      await this.removeMatching(op.temporaryPath, op.contentsHash);
      await this.fs.unlink(this.markerPath(op.path));
    } catch (error) { this.reportCleanup(error); }
  }
}
