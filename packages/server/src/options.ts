// startServer's options: the workspace folder, the port (0 in tests), the user config folder (default
// `$XDG_CONFIG_HOME/nimbo` or `~/.config/nimbo`, `%APPDATA%\nimbo` on Windows), the built UI folder, the kernel entry
// (default: the built kernel-node), an injectable id generator and clock (09-testing §1.4), the log level (NIMBO_LOG)
// and the daemon's own timeouts for a route request and a /npm/ build (30 s each by default).
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { IdGenerator } from "@jsnb/core";
import { InvalidParams, randomIds } from "@jsnb/core";
import type { KernelEntry } from "@jsnb/kernel-node";
import { z } from "zod";

import { jsonIssues } from "./commands/wireError.js";
import { withLegacyConfigMoved } from "./files/legacyConfigDir.js";
import type { LogLevel } from "./files/logs/logger.js";
import { levelOf } from "./files/logs/logger.js";
import { defaultRequestTimeoutMs } from "./kernel/requests.js";
import { maxTimerMs } from "./kernel/timers.js";

export type ServerOptions = {
  /** The workspace folder (absolute or relative to the cwd); it must exist. */
  readonly workspace: string;
  /** The port on 127.0.0.1; 0 (the default) picks a free one. */
  readonly port?: number;
  /** Where the user settings file lives. */
  readonly userConfigDir?: string;
  /** The built UI (`packages/ui/dist`), served at /ui/; without it /ui/ answers a page naming the missing build. */
  readonly uiDir?: string;
  /** The kernel script; default kernel-node's built `dist/main.js`. */
  readonly kernelEntry?: KernelEntry;
  readonly ids?: IdGenerator;
  readonly now?: () => Date;
  /** Default from `NIMBO_LOG`, else info. */
  readonly logLevel?: LogLevel;
  /** Also write the log to stderr (`nimbo serve` in the foreground). */
  readonly logToStderr?: boolean;
  /** How long a route request may take before it answers 504; default 30 s. */
  readonly routeTimeoutMs?: number;
  /** How long one /npm/ build may run before it is cancelled; default 30 s. */
  readonly bundleTimeoutMs?: number;
  /** The size at which `.jsnb/logs/daemon.log` rotates (07-file-format §7); default 1 MiB. */
  readonly logMaxBytes?: number;
  /** How long one packages.add may run before its package manager is killed; default 10 minutes. */
  readonly installTimeoutMs?: number;
  /** How long the daemon waits for a kernel's snapshot or bindings answer and a page's reset; default 10 s. */
  readonly requestTimeoutMs?: number;
  /** How often the daemon checks that its workspace folder still exists and that each open notebook's file
   * is where it was (07 §5); default 2 s. */
  readonly rootCheckMs?: number;
  /** The daemon's own process entry, which workspace.open runs to start another folder's daemon; default the built
   * `dist/main.js` beside this module, when this module is the built one. */
  readonly daemonEntry?: string;
};

export type ResolvedOptions = {
  readonly workspace: string;
  readonly port: number;
  readonly userConfigDir: string;
  readonly uiDir: string | undefined;
  readonly kernelEntry: KernelEntry | undefined;
  readonly ids: IdGenerator;
  readonly now: () => Date;
  readonly logLevel: LogLevel;
  readonly logToStderr: boolean;
  readonly routeTimeoutMs: number;
  readonly bundleTimeoutMs: number;
  readonly logMaxBytes: number;
  readonly installTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly rootCheckMs: number;
  readonly daemonEntry: string | undefined;
};

const Plain = z.object({
  workspace: z.string().min(1),
  port: z.number().int().min(0).max(65_535).optional(),
  userConfigDir: z.string().min(1).optional(),
  uiDir: z.string().min(1).optional(),
  kernelEntry: z
    .object({ path: z.string().min(1), execArgv: z.array(z.string()).readonly().optional() })
    .optional(),
  logLevel: z.enum(["error", "warn", "info", "debug"]).optional(),
  logToStderr: z.boolean().optional(),
  routeTimeoutMs: z.number().int().positive().max(maxTimerMs).optional(),
  bundleTimeoutMs: z.number().int().positive().max(maxTimerMs).optional(),
  logMaxBytes: z.number().int().positive().optional(),
  installTimeoutMs: z.number().int().positive().max(maxTimerMs).optional(),
  requestTimeoutMs: z.number().int().positive().max(maxTimerMs).optional(),
  rootCheckMs: z.number().int().positive().max(maxTimerMs).optional(),
  daemonEntry: z.string().min(1).optional(),
});

/** The built entry beside this module (dist/options.js → dist/main.js); none when this module runs from its source. */
function builtEntry(): string | undefined {
  const entry = fileURLToPath(new URL("./main.js", import.meta.url));
  return existsSync(entry) ? entry : undefined;
}

/** The user config folder of 07-file-format §6. */
export function defaultUserConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32" && env.APPDATA) return join(env.APPDATA, "nimbo");
  const xdg = env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, "nimbo") : join(homedir(), ".config", "nimbo");
}

/** The daemon's own limits: 30 s for a route and for a bundle, 10 minutes for an install, 10 s for a kernel's or a
 * page's answer, 1 MiB of daemon.log. */
const limitsOf = (options: ServerOptions) => ({
  routeTimeoutMs: options.routeTimeoutMs ?? 30_000,
  bundleTimeoutMs: options.bundleTimeoutMs ?? 30_000,
  installTimeoutMs: options.installTimeoutMs ?? 600_000,
  requestTimeoutMs: options.requestTimeoutMs ?? defaultRequestTimeoutMs,
  logMaxBytes: options.logMaxBytes ?? 1_048_576,
  rootCheckMs: options.rootCheckMs ?? 2000,
});

/** The options with their defaults; InvalidParams with the issues for options that are not valid. */
export function resolveOptions(options: ServerOptions): ResolvedOptions {
  const parsed = Plain.safeParse(options);
  if (!parsed.success) {
    throw new InvalidParams({
      issues: jsonIssues(parsed.error.issues.map(({ path, message }) => ({ path, message }))),
    });
  }
  return {
    workspace: options.workspace,
    port: options.port ?? 0,
    userConfigDir: options.userConfigDir ?? withLegacyConfigMoved(defaultUserConfigDir()),
    uiDir: options.uiDir,
    kernelEntry: options.kernelEntry,
    ids: options.ids ?? randomIds(),
    now: options.now ?? (() => new Date()),
    logLevel: options.logLevel ?? levelOf(process.env.NIMBO_LOG),
    logToStderr: options.logToStderr ?? false,
    ...limitsOf(options),
    daemonEntry: options.daemonEntry ?? builtEntry(),
  };
}
