import "dotenv/config";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const dbDefine = {
  "process.env.DATABASE_URL": JSON.stringify(process.env.DATABASE_URL ?? null),
  "process.env.DATABASE_AUTH_TOKEN": JSON.stringify(
    process.env.DATABASE_AUTH_TOKEN ?? null,
  ),
};

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error(
    "Build en CI sin DATABASE_URL: definí los secrets DATABASE_URL y " +
      "DATABASE_AUTH_TOKEN en el repo antes de publicar el release.",
  );
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: dbDefine,
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react(), tailwindcss()],
  },
});
