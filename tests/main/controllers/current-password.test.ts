import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { loadCurrentPassword } from "../../../src/main/controllers/current-password";

let client: Client | undefined;
afterEach(() => { client?.close(); client = undefined; });

describe("loadCurrentPassword", () => {
  it.each(["legacy", "current"] as const)("reads the latest password from the %s schema without relying on ISA flags", async (layout) => {
    client = createClient({ url: "file::memory:" });
    await client.executeMultiple(layout === "legacy" ? `
      CREATE TABLE contrasena (contrasena_id TEXT PRIMARY KEY, contrasena_hash TEXT,
        contrasena_fecha_hora_creacion TEXT, usuario_id TEXT);
      CREATE TABLE contrasena_temporal (contrasena_temporal_id TEXT PRIMARY KEY,
        contrasena_temporal_fecha_hora_expiracion TEXT, contrasena_id TEXT UNIQUE);
      INSERT INTO contrasena VALUES ('older', 'old-hash', '2026-09-01', 'owner');
      INSERT INTO contrasena VALUES ('latest', 'new-hash', '2026-09-02', 'owner');
      INSERT INTO contrasena_temporal VALUES ('legacy-id', '2026-10-01', 'older');
    ` : `
      CREATE TABLE contrasena (contrasena_id TEXT PRIMARY KEY, contrasena_hash TEXT,
        contrasena_fecha_hora_creacion TEXT, usuario_id TEXT,
        es_contrasena_temporal INTEGER, es_contrasena_definitiva INTEGER);
      CREATE TABLE contrasena_temporal (contrasena_id TEXT PRIMARY KEY,
        contrasena_temporal_fecha_hora_expiracion TEXT);
      INSERT INTO contrasena VALUES ('older', 'old-hash', '2026-09-01', 'owner', 1, 0);
      INSERT INTO contrasena VALUES ('latest', 'new-hash', '2026-09-02', 'owner', 0, 1);
      INSERT INTO contrasena_temporal VALUES ('older', '2026-10-01');
    `);
    const db = drizzle(client, { schema });
    expect(await loadCurrentPassword(db, schema, "owner")).toMatchObject({
      contrasenaId: "latest", contrasenaHash: "new-hash", esContrasenaTemporal: false,
    });
    expect(await loadCurrentPassword(db, schema, "missing")).toBeUndefined();
    await client.execute("UPDATE contrasena SET contrasena_fecha_hora_creacion = '2026-09-03' WHERE contrasena_id = 'older'");
    expect(await loadCurrentPassword(db, schema, "owner")).toMatchObject({
      contrasenaId: "older", contrasenaHash: "old-hash", esContrasenaTemporal: true,
      expiracion: "2026-10-01",
    });
  });
});
