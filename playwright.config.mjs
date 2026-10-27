import { createRequire } from 'node:module';
// El repositorio no tiene node_modules: Playwright está instalado globalmente y `import` ESM no consulta
// NODE_PATH, pero `require` sí.
const { defineConfig } = createRequire(import.meta.url)('playwright/test');

export default defineConfig({
  testDir: 'tests/huehuet',
  testMatch: '**/*.spec.mjs',
  use: {
    // CSS px: 440x956 a dpr 3 son los 1320x2868 píxeles de dispositivo del iPhone 17 Pro Max.
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
});
