import 'dotenv/config';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

// Las credenciales de la BD (Turso) se inyectan EN TIEMPO DE BUILD dentro del
// bundle del proceso main. En dev/tests `client.ts` las lee de `.env` vía dotenv,
// pero la app empaquetada no incluye `.env` ni corre desde el cwd del proyecto,
// así que sin esta inyección `process.env.DATABASE_URL` quedaba undefined y el
// exe caía al fallback `file:./local.db` (BD local vacía, sin Turso): la DB no
// conectaba en el release.
//
// Fuente de los valores: `.env` local (builds del dev) o secrets del runner de
// CI (release de GitHub Actions). `?? null` preserva el fallback de dev.
const dbDefine = {
  'process.env.DATABASE_URL': JSON.stringify(process.env.DATABASE_URL ?? null),
  'process.env.DATABASE_AUTH_TOKEN': JSON.stringify(
    process.env.DATABASE_AUTH_TOKEN ?? null,
  ),
};

// Guard anti-release-roto: en CI un build sin DATABASE_URL publicaría un exe que
// apunta a una BD local vacía. Mejor fallar el build que distribuir algo roto.
if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error(
    'Build en CI sin DATABASE_URL: definí los secrets DATABASE_URL y ' +
      'DATABASE_AUTH_TOKEN en el repo antes de publicar el release.',
  );
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: dbDefine,
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
  },
});
