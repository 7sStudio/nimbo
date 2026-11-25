// The built daemon as `nimbo open` forks it (02-architecture §7): `node dist/main.js` over a test's workspace, its user
// config folder inside it, its listening line read from stdout, its exit awaited, killed when the test ends. The tests
// of the process entry and of a run on the built daemon use it (server:integration, after `pnpm build`).
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import type { Workspace } from "@jsnb/test-tools/workspace";
import { onTestFinished } from "vitest";
import { z } from "zod";

import { ServerFile } from "@jsnb/core";

const main = fileURLToPath(new URL("../../dist/main.js", import.meta.url));

const Listening = z.object({
  event: z.literal("listening"),
  url: z.string(),
  port: z.number(),
  workspace: z.string(),
});
type Listening = z.infer<typeof Listening>;

type Exit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

export type BuiltDaemon = {
  readonly child: ChildProcess;
  /** The listening line; rejects when the process exits first. */
  readonly listening: Promise<Listening>;
  readonly exited: Promise<Exit>;
  /** What the process wrote to stderr so far. */
  readonly stderr: () => string;
};

/** Starts `node dist/main.js --workspace <ws> --port 0 --user-config <ws>/.user-config` plus `args`. */
export function spawnBuiltDaemon(ws: Workspace, args: readonly string[] = []): BuiltDaemon {
  if (!existsSync(main))
    throw new Error(
      `These tests run the built daemon and ${main} is missing: run pnpm build first.`,
    );
  const base = ["--workspace", ws.dir, "--port", "0", "--user-config", ws.path(".user-config")];
  const child = spawn(process.execPath, [main, ...base, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  onTestFinished(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  let errors = "";
  child.stderr.on("data", (chunk: Buffer) => (errors += chunk.toString("utf8")));
  const exited = new Promise<Exit>((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
  const listening = new Promise<Listening>((resolve, reject) => {
    createInterface({ input: child.stdout }).once("line", (line) => {
      resolve(Listening.parse(JSON.parse(line)));
    });
    void exited.then((exit) => {
      reject(
        new Error(`the daemon exited (${JSON.stringify(exit)}) before it listened: ${errors}`),
      );
    });
  });
  listening.catch(() => undefined); // a test that expects the failure reads it from `exited` and `stderr`
  return { child, listening, exited, stderr: () => errors };
}

/** The workspace's server.json, parsed. */
export const readServerJson = async (ws: Workspace) =>
  ServerFile.parse(JSON.parse(await readFile(ws.path(".jsnb/server.json"), "utf8")));
