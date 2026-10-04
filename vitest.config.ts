import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // Los imports de controladores pueden cargar client.ts. Nunca deben abrir
    // la conexión real de .env; las integraciones crean sus propias BD temporales.
    env: { DATABASE_URL: "file::memory:", DATABASE_AUTH_TOKEN: "" },
    include: ["tests/**/*.test.ts"],

    maxWorkers: 1,
    hookTimeout: 30000,
  },
});
