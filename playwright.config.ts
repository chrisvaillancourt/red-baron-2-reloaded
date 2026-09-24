import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 5199);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    // Hardware GL via ANGLE/Metal (the real renderer is far too heavy for SwiftShader).
    // Set E2E_SWIFTSHADER=1 on machines without a GPU.
    launchOptions: {
      args: process.env.E2E_SWIFTSHADER
        ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'],
    },
  },
  // Uses the installed Google Chrome (no browser download needed); override with PW_CHANNEL=chromium.
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL ?? 'chrome', viewport: { width: 1280, height: 720 } } }],
  webServer: {
    // Call the vite shim directly: `pnpm exec` does not forward SIGTERM, which hangs teardown.
    command: `./node_modules/.bin/vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Never reuse: a server left running from another worktree would serve the wrong code.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
