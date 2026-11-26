// The headless page's CDP relay for js-debug against the system's real Chrome: a Unix socket in a
// new 0700 folder, at a secret path; a wrong path is refused, the first connection is the only one (the folder goes with
// it), the page's Runtime answers and the browser's methods and other domains are refused. Skipped, with the reason in
// its name, on a machine with no Chrome, Chromium or Edge.
import { statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import type { Log } from "../../events/log.js";
import { findBrowser } from "./executable.js";
import type { Launched } from "./launch.js";
import { end, launch } from "./launch.js";
import { openCdpRelay } from "./relay.js";

const browser = findBrowser(null);
const suite = browser.found ? describe : describe.skip;
const skipped = browser.found ? "" : " (skipped: no Chrome, Chromium or Edge on this machine)";

const quiet: Log = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  child: () => quiet,
};

/** Connects to `url`, or the error code it fails with. */
const connect = (url: string): Promise<WebSocket | string> =>
  new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.once("open", () => {
      resolve(ws);
    });
    ws.once("error", (error: Error & { code?: string }) => {
      resolve(error.code ?? error.message);
    });
  });

/** One CDP request over `ws`, answered by its id. */
function send(ws: WebSocket, id: number, method: string, params: object = {}): Promise<unknown> {
  return new Promise((resolve) => {
    const heard = (data: Buffer): void => {
      const message = JSON.parse(data.toString("utf8")) as { id?: number };
      if (message.id !== id) return;
      ws.off("message", heard);
      resolve(message);
    };
    ws.on("message", heard);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

let dir: string;
let launched: Launched | undefined;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nimbo-relay-"));
  if (!browser.found) return;
  launched = await launch(browser.path, await mkdtemp(join(dir, "profile-")), {
    sandbox: true,
    log: quiet,
    signal: new AbortController().signal,
  });
});
afterAll(async () => {
  if (launched) await end(launched);
  await rm(dir, { recursive: true, force: true });
});

suite(`the debugger's CDP relay${skipped}`, { timeout: 30_000 }, () => {
  it("takes one connection at its secret path, relays the page's Runtime and refuses the browser's methods", async () => {
    const page = await launched!.browser.newPage();
    const relay = await openCdpRelay(page, { dir, log: quiet });
    const match = /^ws\+unix:(.+):\/([A-Za-z0-9_-]{32})$/u.exec(relay.url);
    expect(match).not.toBeNull();
    const socket = match?.[1] ?? "";
    expect(statSync(dirname(socket)).mode & 0o777).toBe(0o700);

    const wrong = await connect(`ws+unix:${socket}:/not-the-secret`);
    expect(typeof wrong).toBe("string"); // refused: the connection is dropped before any upgrade
    const ws = await connect(relay.url);
    expect(ws).toBeInstanceOf(WebSocket);
    if (!(ws instanceof WebSocket)) return;
    expect(await connect(relay.url)).toBe("ENOENT"); // the folder and its socket went with the first connection

    expect(await send(ws, 1, "Runtime.evaluate", { expression: "6 * 7" })).toMatchObject({
      id: 1,
      result: { result: { type: "number", value: 42 } },
    });
    for (const [id, method] of [
      [2, "Target.getTargets"],
      [3, "Browser.getVersion"],
      [4, "Page.navigate"],
      [5, "Network.enable"],
      [6, "Target.createTarget"],
    ] as const)
      expect(await send(ws, id, method, { url: "about:blank" })).toMatchObject({
        id,
        error: { code: -32601 },
      });

    const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    relay.close();
    await closed;
    expect(relay.closed.aborted).toBe(true);
    await page.close();
  });

  it("closes once its page closes", async () => {
    const page = await launched!.browser.newPage();
    const relay = await openCdpRelay(page, { dir, log: quiet });
    const ws = await connect(relay.url);
    expect(ws).toBeInstanceOf(WebSocket);
    await page.close();
    await expect.poll(() => relay.closed.aborted).toBe(true);
  });
});
