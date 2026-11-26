// Launching and ending the headless browser. The daemon spawns the browser itself, in a process
// group of its own, and connects puppeteer-core over its pipe (no debugging port on TCP), so it always holds the process:
// a browser that hangs at start is killed with its group after a bound, and a stop kills a launch in flight. The sandbox
// stays on unless realm.headlessSandbox is off; permission prompts are denied, popups blocked and any window a page
// opens closed, downloads denied; the background fetches Chrome lets a flag or a preference stop are stopped; crash
// data goes to the fresh 0700 profile under `.jsnb/headless/`, never to the user's own browser's crash database.
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import { JsnbError } from "@jsnb/core";
import type { Browser, ConnectionTransport } from "puppeteer-core";
import puppeteer, { TargetType } from "puppeteer-core";

import type { Log } from "../../events/log.js";

/** The headless realm could not get a page; the message says why and what to do. */
export class HeadlessFailed extends JsnbError {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super({ name: "HeadlessFailed", message, ...options });
  }
}

/** The browser and the process the daemon spawned for it. */
export type Launched = {
  readonly browser: Browser;
  readonly child: ChildProcess;
  readonly profile: string;
};

/** How long a launch has, from the spawn to a browser that answers. */
const launchTimeoutMs = 15_000;
/** Every protocol call to the browser; puppeteer's own default is three minutes. */
const protocolTimeoutMs = 30_000;
/** How long a polite close, then an exit after SIGKILL, may take. */
const closeTimeoutMs = 3000;

const firstLine = (text: string): string => text.split("\n")[0]?.trim() ?? "";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function notFound(setting: string | null, looked: readonly string[]): HeadlessFailed {
  if (setting !== null)
    return new HeadlessFailed(
      `realm.headlessBrowser names ${setting}, which is not an executable file. Point it at Chrome, Chromium or Edge, or set it to null to find one.`,
    );
  return new HeadlessFailed(
    `no Chrome, Chromium or Edge was found: looked at ${looked.join(", ")}. Install one, or set realm.headlessBrowser to its executable (or CHROME_PATH).`,
  );
}

function launchFailed(path: string, error: unknown, stderr: string): HeadlessFailed {
  if (/No usable sandbox/iu.test(`${messageOf(error)}\n${stderr}`))
    return new HeadlessFailed(
      `${path} cannot start with its sandbox on this system (No usable sandbox: unprivileged user namespaces are off, as in many containers). Allow them, or turn realm.headlessSandbox off to run client cells without the browser's sandbox.`,
      { cause: error },
    );
  const said = firstLine(stderr.trim().split("\n").at(-1) ?? "");
  const why = said === "" ? firstLine(messageOf(error)) : said;
  return new HeadlessFailed(`${path} did not start: ${why}`, { cause: error });
}

const hung = (path: string): HeadlessFailed =>
  new HeadlessFailed(
    `the browser at ${path} hung at start: it did not answer within ${String(launchTimeoutMs / 1000)} s and was killed. Point realm.headlessBrowser at Chrome, Chromium or Edge.`,
  );

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

/** Background fetches Chrome lets a flag stop: component updates, network time, domain reliability, autofill and
 * optimisation-guide downloads, certificate-transparency lists, link pings. */
const quiet = [
  "--disable-component-update",
  "--disable-domain-reliability",
  "--no-pings",
  "--no-default-browser-check",
  "--disable-features=NetworkTimeServiceQuerying,AutofillServerCommunication,CertificateTransparencyComponentUpdater,OptimizationGuideModelDownloading,OptimizationHintsFetching,InterestFeedContentSuggestions,PrivacySandboxSettings4",
];

/** The profile's first preferences: no Safe Browsing lookups, no sign-in, no search suggestions. */
const preferences = {
  safebrowsing: { enabled: false },
  signin: { allowed: false },
  search: { suggest_enabled: false },
};

/** puppeteer's flags (its `--disable-features` merged with ours), the pipe, popups left blocked. */
async function argsOf(profile: string, sandbox: boolean): Promise<string[]> {
  const extra = ["--deny-permission-prompts", ...quiet, ...(sandbox ? [] : ["--no-sandbox"])];
  const args = await puppeteer.defaultArgs({ headless: true, userDataDir: profile, args: extra });
  return [...args.filter((arg) => arg !== "--disable-popup-blocking"), "--remote-debugging-pipe"];
}

/** CDP over the browser's pipe: fd 3 it reads, fd 4 it writes, each message ended by a NUL. */
function pipeTransport(child: ChildProcess): ConnectionTransport {
  const input = child.stdio[3];
  const output = child.stdio[4];
  if (!(input instanceof Writable) || !(output instanceof Readable))
    throw new HeadlessFailed("the browser's pipe did not open.");
  const transport: ConnectionTransport = {
    send: (message) => {
      input.write(`${message}\0`);
    },
    close: () => {
      input.end();
    },
  };
  let pending = "";
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    pending += chunk;
    for (let end = pending.indexOf("\0"); end >= 0; end = pending.indexOf("\0")) {
      const message = pending.slice(0, end);
      pending = pending.slice(end + 1);
      transport.onmessage?.(message);
    }
  });
  output.on("close", () => transport.onclose?.());
  input.on("error", () => undefined);
  output.on("error", () => undefined);
  return transport;
}

/** Kills the browser's process group (its helpers with it), then waits a bounded time for it to exit. */
async function kill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  try {
    if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  await Promise.race([exited, delay(closeTimeoutMs)]);
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms).unref());

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

/** The browser at `path` spawned in `profile`, connected and locked down within launchTimeoutMs; HeadlessFailed, its
 * process group killed and the profile removed, when it fails, hangs, or `signal` aborts (a stop). */
export async function launch(
  path: string,
  profile: string,
  options: { readonly sandbox: boolean; readonly log: Log; readonly signal: AbortSignal },
): Promise<Launched> {
  await mkdir(join(profile, "Default"));
  await writeFile(join(profile, "Default", "Preferences"), JSON.stringify(preferences));
  const child = spawn(path, await argsOf(profile, options.sandbox), {
    detached: true,
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
    env: { ...process.env, BREAKPAD_DUMP_LOCATION: join(profile, "Crashpad") },
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
  });
  const bound = new AbortController();
  const failed = new Promise<never>((_resolve, reject) => {
    child.once("error", reject);
    const timer = setTimeout(() => {
      reject(hung(path));
    }, launchTimeoutMs);
    timer.unref();
    const stopping = (): void => {
      reject(new HeadlessFailed("the daemon is stopping."));
    };
    options.signal.addEventListener("abort", stopping, { signal: bound.signal });
    bound.signal.addEventListener("abort", () => {
      clearTimeout(timer);
    });
  });
  failed.catch(() => undefined);
  try {
    const connected = puppeteer.connect({
      transport: pipeTransport(child),
      protocolTimeout: protocolTimeoutMs,
      defaultViewport: { width: 1024, height: 768 },
    });
    connected.catch(() => undefined);
    const browser = await Promise.race([connected, failed]);
    await Promise.race([lockDown(browser, options.log), failed]);
    return { browser, child, profile };
  } catch (error) {
    await kill(child);
    await rm(profile, { recursive: true, force: true });
    throw error instanceof HeadlessFailed ? error : launchFailed(path, error, stderr);
  } finally {
    bound.abort();
  }
}

/** Whether the browser still answers and its process runs. */
export const alive = ({ browser, child }: Launched): boolean =>
  browser.connected && child.exitCode === null && child.signalCode === null;

/** Ends the browser: a polite close bounded in time, then its group killed; its profile goes once it exited. */
export async function end({ browser, child, profile }: Launched): Promise<void> {
  await Promise.race([browser.close().catch(() => undefined), delay(closeTimeoutMs)]);
  await kill(child);
  await rm(profile, { recursive: true, force: true });
}
