import { defineConfig, devices } from '@playwright/test';

// iPad Pro 11 インチ相当の画面で、WebKit(Safari のエンジン)と Chromium の両方で動かす
const ipad = { viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2, hasTouch: true };

export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  use: { baseURL: 'http://localhost:4317/tsugigami/' },
  webServer: { command: 'npx vite build && npx vite preview --port 4317 --strictPort', url: 'http://localhost:4317/tsugigami/', reuseExistingServer: false, timeout: 60000 },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'], ...ipad } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...ipad } },
  ],
});
