// Playwright: Chromium only. The "browser" stage is the ui's user journeys, one project per
// target screen (MacBook Pro 14 inch and a large display; no phone or tablet), each journey starting
// its own daemon through the built CLI, so no web server is shared. "acceptance" is for the demos.
import { defineConfig, devices } from "@playwright/test";

/** The supported screens at their logical sizes; every journey runs at each. */
const screens = [
  { name: "mbp14", viewport: { width: 1512, height: 982 } },
  { name: "large", viewport: { width: 2560, height: 1440 } },
] as const;

export default defineConfig({
  testMatch: ["packages/*/e2e/**/*.spec.ts", "tools/test/**/*.e2e.ts"],
  fullyParallel: true,
  retries: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  // baselines live beside each spec, one folder per spec, one file per step and screen
  snapshotPathTemplate:
    "{testDir}/{testFileDir}/__screenshots__/{testFileName}/{arg}-{projectName}{ext}",
  expect: { toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css" } },
  use: { trace: "on-first-retry", colorScheme: "light" },
  projects: [
    ...screens.map((screen) => ({
      name: `browser-${screen.name}`,
      timeout: 10_000,
      testIgnore: ["**/acceptance/**"],
      // Chromium's own user agent, so the page's ⌘ or Ctrl matches the host's ControlOrMeta in the journeys
      use: { browserName: "chromium" as const, viewport: screen.viewport, deviceScaleFactor: 1 },
    })),
    {
      name: "acceptance",
      timeout: 120_000,
      testMatch: ["**/acceptance/**"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
