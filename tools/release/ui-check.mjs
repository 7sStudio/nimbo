// The page checks of tools/release/check.sh, run with the repository's Playwright against an installed release's
// daemon: the notebook page loads with the server cell's output, a client cell runs in it, and (with --install-sql)
// the Settings row installs DuckDB.
//
//   node tools/release/ui-check.mjs <page url> <server output text> [--install-sql]
//   CLIENT_RUN='["nimbo", "cell", "run", …]' CLIENT_TEXT='<its output>' to run a client cell while the page is open
import { execFileSync } from "node:child_process";

import { chromium } from "playwright";

const [url = "", expected = "", ...rest] = process.argv.slice(2);
const installSql = rest.includes("--install-sql");
const clientRun = JSON.parse(process.env.CLIENT_RUN ?? "[]");

const step = (text) => process.stdout.write(`ui: ${text}\n`);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
  await page.goto(url);
  await page.getByText(expected, { exact: false }).first().waitFor({ timeout: 30_000 });
  step(`notebook page loaded, server output "${expected}" shown`);
  if (clientRun.length > 0) {
    // the run goes through the daemon to this page, the realm attached
    const [command = "", ...args] = clientRun;
    execFileSync(command, args, {
      encoding: "utf8",
      cwd: process.env.CLIENT_CWD,
      env: JSON.parse(process.env.CLIENT_ENV ?? "{}"),
    });
    const shown = process.env.CLIENT_TEXT ?? "";
    await page.getByText(shown).first().waitFor({ timeout: 30_000 });
    step(`client cell ran in the page: "${shown}"`);
  }
  if (installSql) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
    const row = page.locator('[data-part="sql-engine"]');
    await row.getByText("not installed").waitFor({ timeout: 15_000 });
    step("Settings shows: DuckDB for CLI and agent SQL: not installed");
    await row.getByRole("button", { name: "Install" }).click();
    await row.getByText("Installed").waitFor({ timeout: 300_000 });
    step("DuckDB installed from the Settings row");
  }
} finally {
  await browser.close();
}
