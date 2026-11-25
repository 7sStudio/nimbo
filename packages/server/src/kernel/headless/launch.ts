// Launching and ending the headless browser (02-architecture §8): puppeteer-core over the pipe (no debugging port on
// TCP), the sandbox on unless realm.headlessSandbox is off, permission prompts denied, popups blocked and any window a
// page opens closed, downloads denied, in a fresh 0700 profile under `.jsnb/headless/`; the failures worded for the
// user, the sandbox's own named.
import { chmod, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { JsnbError } from "@jsnb/core";
import type { Browser } from "puppeteer-core";
import puppeteer, { TargetType } from "puppeteer-core";

import type { Log } from "../../events/log.js";

/** The headless realm could not get a page; the message says why and what to do. */
export class HeadlessFailed extends JsnbError {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super({ name: "HeadlessFailed", message, ...options });
  }
}

const launchTimeoutMs = 30_000;
const closeTimeoutMs = 3000;

const firstLine = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0]?.trim() ?? "";

export function notFound(setting: string | null, looked: readonly string[]): HeadlessFailed {
  if (setting !== null)
    return new HeadlessFailed(
      `realm.headlessBrowser names ${setting}, which is not an executable file. Point it at Chrome, Chromium or Edge, or set it to null to find one.`,
    );
  return new HeadlessFailed(
    `no Chrome, Chromium or Edge was found: looked at ${looked.join(", ")}. Install one, or set realm.headlessBrowser to its executable (or CHROME_PATH).`,
  );
}

function launchFailed(path: string, error: unknown): HeadlessFailed {
  if (/No usable sandbox/iu.test(error instanceof Error ? error.message : String(error)))
    return new HeadlessFailed(
      `${path} cannot start with its sandbox on this system (No usable sandbox: unprivileged user namespaces are off, as in many containers). Allow them, or turn realm.headlessSandbox off to run client cells without the browser's sandbox.`,
      { cause: error },
    );
  return new HeadlessFailed(`${path} did not start: ${firstLine(error)}`, { cause: error });
}

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** `.jsnb/headless/` as a real 0700 folder of this user (never a link). */
async function profilesDir(dir: string): Promise<void> {
  await mkdir(dir, { mode: 0o700 }).catch((error: unknown) => {
    if (codeOf(error) !== "EEXIST") throw error;
  });
  const made = await lstat(dir);
  if (!made.isDirectory() || made.uid !== process.getuid?.())
    throw new HeadlessFailed(`${dir} is not a folder of this user; remove it.`);
  await chmod(dir, 0o700);
}

/** The profiles' folder, with the profiles a daemon that died left removed (one daemon per workspace: none is in use). */
export async function prepareProfiles(dir: string, log: Log): Promise<void> {
  await profilesDir(dir);
  const names = await readdir(dir).catch(() => []);
  for (const name of names.filter((each) => each.startsWith("profile-")))
    await rm(join(dir, name), { recursive: true, force: true }).catch((error: unknown) => {
      log.debug({ err: error, name }, "a headless profile was left as it is");
    });
}

/** The launch flags beyond puppeteer's defaults; popups stay blocked (its default unblocks them). */
const launchArgs = (sandbox: boolean): string[] => [
  "--deny-permission-prompts",
  "--disable-features=MediaRouter",
  ...(sandbox ? [] : ["--no-sandbox"]),
];

/** Downloads denied, and every popup or window a page opens closed at once. */
async function lockDown(browser: Browser, log: Log): Promise<void> {
  const session = await browser.target().createCDPSession();
  await session.send("Browser.setDownloadBehavior", { behavior: "deny" });
  browser.on("targetcreated", (target) => {
    if (target.type() !== TargetType.PAGE || target.opener() === undefined) return;
    log.warn({ url: target.url() }, "a headless page opened a window; it was closed");
    void target
      .page()
      .then((page) => page?.close())
      .catch(() => undefined);
  });
}

/** The browser at `path` in `profile`, locked down; HeadlessFailed (the profile removed) when it does not start. */
export async function launch(
  path: string,
  profile: string,
  { sandbox, log }: { readonly sandbox: boolean; readonly log: Log },
): Promise<Browser> {
  try {
    const browser = await puppeteer.launch({
      ...{ executablePath: path, pipe: true, headless: true, userDataDir: profile },
      args: launchArgs(sandbox),
      ignoreDefaultArgs: ["--disable-popup-blocking"],
      defaultViewport: { width: 1024, height: 768 },
      ...{ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false },
      timeout: launchTimeoutMs,
    });
    await lockDown(browser, log);
    return browser;
  } catch (error) {
    await rm(profile, { recursive: true, force: true });
    throw launchFailed(path, error);
  }
}

/** Whether the browser still answers and its process runs. */
export function alive(browser: Browser): boolean {
  const child = browser.process();
  return (
    browser.connected && (child === null || (child.exitCode === null && child.signalCode === null))
  );
}

/** Ends the browser: a polite close, then SIGKILL; its profile goes once it exited. */
export async function end(browser: Browser, profile: string): Promise<void> {
  const child = browser.process();
  const exited =
    child?.exitCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          child.once("exit", () => {
            resolve();
          });
        });
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, closeTimeoutMs).unref());
  await Promise.race([browser.close().catch(() => undefined), timeout]);
  if (child !== null && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await Promise.race([exited, timeout]);
  await rm(profile, { recursive: true, force: true });
}
