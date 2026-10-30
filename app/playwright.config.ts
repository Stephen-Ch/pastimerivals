// Plan 59 Round 1a: browser tests against a local build. Cloud only (the laptop VM has no npm).
// Everything is served from dist by e2e/harness.ts; nothing reaches the live site.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: /\.e2e\.ts$/,
  outputDir: 'dist/e2e-results',
  timeout: 60_000,
  workers: 2,
  reporter: [['list']],
  use: { baseURL: 'http://pr.test', serviceWorkers: 'block', reducedMotion: 'no-preference' },
  projects: [
    { name: 'phone-small', use: { viewport: { width: 320, height: 568 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 } } },
    { name: 'landscape', use: { viewport: { width: 568, height: 320 } } },
  ],
});
