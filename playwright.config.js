const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node server/index.js",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    env: { ...process.env, PORT: "3100", HOST: "127.0.0.1", NODE_ENV: "test" }
  }
});
