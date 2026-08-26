import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as yaml from 'js-yaml'; // v5 ships named exports only (no default)
import configBuilder from './vendor/integration/utils/configBuilder';
import type { Config } from './vendor/integration/utils/configBuilder';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawYaml = readFileSync(path.join(__dirname, 'src/config.yaml'), 'utf8');
const rawConfig = yaml.load(rawYaml) as Config;
const { SITE, I18N, METADATA, APP_BLOG, UI, ANALYTICS } = configBuilder(rawConfig);

export default defineConfig({
  plugins: [
    {
      name: 'astrowind-config',
      resolveId(id) {
        if (id === 'astrowind:config') return '\0astrowind:config';
      },
      load(id) {
        if (id === '\0astrowind:config') {
          return `
            export const SITE = ${JSON.stringify(SITE)};
            export const I18N = ${JSON.stringify(I18N)};
            export const METADATA = ${JSON.stringify(METADATA)};
            export const APP_BLOG = ${JSON.stringify(APP_BLOG)};
            export const UI = ${JSON.stringify(UI)};
            export const ANALYTICS = ${JSON.stringify(ANALYTICS)};
          `;
        }
      },
    },
  ],
  resolve: {
    alias: {
      '~/': path.resolve(__dirname, 'src') + '/',
    },
  },
  test: {
    globals: false,
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/__tests__/**',
        'src/env.d.ts',
        'src/types.d.ts',
        'src/content.config.ts',
      ],
    },
  },
});
