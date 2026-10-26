import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// 公開版(GitHub Pages)に対して同じテストを流す: npx playwright test -c playwright.prod.config.ts
export default defineConfig({ ...base, webServer: undefined, use: { ...base.use, baseURL: 'https://nishio.github.io/tsugigami/' } });
