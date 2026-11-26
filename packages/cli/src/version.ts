// `--version`: the product's version, the commit it was built from, how it was installed and the API version it speaks.
// A release build stamps the version and commit into core; a checkout reads its commit from git.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { apiVersion, productCommit, productName, productVersion } from "@jsnb/core";

import { findInstallation } from "./install/installation.js";

const run = promisify(execFile);

/** The checkout's short commit, "" where git cannot tell. */
async function checkoutCommit(folder: string): Promise<string> {
  try {
    const { stdout } = await run("git", ["-C", folder, "rev-parse", "--short", "HEAD"], {
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

/** `nimbo 0.1.0 (abc1234, installer, API 1)`. */
export async function versionText(): Promise<string> {
  const installation = await findInstallation();
  const commit =
    productCommit ||
    (installation.method === "source" ? await checkoutCommit(installation.appDir) : "");
  const parts = [commit, installation.method, `API ${String(apiVersion)}`].filter(
    (part) => part !== "",
  );
  return `${productName} ${productVersion} (${parts.join(", ")})\n`;
}
