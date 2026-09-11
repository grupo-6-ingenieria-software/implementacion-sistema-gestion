import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "../../src") } },
  test: {
    environment: "node",
    include: ["tests/renderer/inventory-ui.chromium.ts"],
    maxWorkers: 1,
    testTimeout: 30000,
  },
});
