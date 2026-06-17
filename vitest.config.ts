import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Config unica de Vitest. Los tests viven en `tests/` (espejo de `src/`) e
// importan el codigo de produccion vía rutas relativas a `src/`. El alias `@`
// permite ademas importar como `@/...` desde cualquier test sin contar saltos
// de `../`.
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Los controllers comparten una BD SQLite temporal por archivo; correr en un
    // solo worker evita choques entre suites y replica el flag de CI.
    maxWorkers: 1,
    hookTimeout: 30000,
  },
});
