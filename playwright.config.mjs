import { createRequire } from 'node:module';
// El repositorio no tiene node_modules: Playwright está instalado globalmente y `import` ESM no consulta
// NODE_PATH, pero `require` sí.
const { defineConfig } = createRequire(import.meta.url)('playwright/test');

export default defineConfig({
  testDir: 'tests/huehuet',
  testMatch: '**/*.spec.mjs',
  use: {
    viewport: { width: 1320, height: 2868 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
});
