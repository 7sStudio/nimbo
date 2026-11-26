// packages.add and packages.remove: the names checked (specs to add; declared package
// names to remove), package.json created when there is none, the manager of the packages.manager setting run in
// the workspace (no shell), its output lines as packages.progress events (redacted), packages.done at the end; one run
// at a time per workspace (packages.ts), stopped with the daemon or by packages.cancel. A manager that fails is
// PackagesNotAdded or PackagesNotRemoved with its first error, a remedy and the end of its output, one that is not
// installed PackageManagerMissing naming it and the setting, one that runs past the install timeout (startServer's installTimeoutMs, 10 minutes) is
// killed and PackagesTimedOut, one a packages.cancel stopped PackagesCancelled; each frees the lock.
import type { Settings } from "@jsnb/core";
import { InvalidParams, JsnbError } from "@jsnb/core";

import type { EventBus } from "../../events/bus.js";
import type { Log } from "../../events/log.js";
import type { DeclaredPackage } from "../../files/packages/manifest.js";
import {
  declaredPackages,
  ensureManifest,
  installedVersion,
} from "../../files/packages/manifest.js";
import type { Manager } from "../../files/packages/manager.js";
import {
  addArgs,
  checkSpecs,
  managerFor,
  nameOf,
  removeArgs,
} from "../../files/packages/manager.js";
import { ManagerOutput, remedyFor } from "../../files/packages/managerOutput.js";
import { isLocalSpec, localPackageName, localProblem } from "../../files/packages/local.js";
import { runManager } from "./managerProcess.js";
import { DaemonStopping } from "./openErrors.js";
import type { PackageAction } from "./packageErrors.js";
import {
  PackageManagerMissing,
  PackagesCancelled,
  PackagesNotAdded,
  PackagesNotRemoved,
  PackagesTimedOut,
} from "./packageErrors.js";

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

export type InstallOptions = {
  readonly root: string;
  readonly bus: EventBus;
  readonly settings: () => Settings;
  readonly redact: (text: string) => string;
  /** Aborts once the daemon stops. */
  readonly stop: AbortSignal;
  readonly log: Log;
  /** How long the package manager may run before it is killed. */
  readonly timeoutMs: number;
};

/** What packages.ts holds of a run: the packages.cancel that may stop it, and the word that its manager ended, after
 * which a cancel no longer can. */
export type RunControl = { readonly cancel: AbortSignal; readonly past: () => void };

/** One run of the package manager: what it does, to which names, and its control. */
type Run = RunControl & {
  readonly action: PackageAction;
  readonly names: readonly string[];
};

/** Why the manager did not run to its end: not installed, killed past the timeout, cancelled, or stopped. */
function whyNotRun(
  error: unknown,
  run: Run & { readonly manager: Manager; readonly stop: AbortSignal },
  timeout: { readonly signal: AbortSignal; readonly timeoutMs: number },
): unknown {
  const { manager, names, action } = run;
  if (codeOf(error) === "ENOENT") return new PackageManagerMissing({ manager }, { cause: error });
  if (timeout.signal.aborted)
    return new PackagesTimedOut(
      { names, manager, timeoutMs: timeout.timeoutMs, action },
      { cause: error },
    );
  if (run.stop.aborted) return new DaemonStopping({ names }); // a stop, not a daemon bug
  if (run.cancel.aborted)
    return new PackagesCancelled({ names, manager, action, started: true }, { cause: error });
  return error;
}

/** Each line of the manager's output, redacted: kept for a failure's message and sent as packages.progress. */
const progressOf =
  (options: InstallOptions, run: Run, output: ManagerOutput) =>
  (raw: string): void => {
    const line = options.redact(raw);
    output.push(line);
    options.bus.emit("", "packages.progress", { names: [...run.names], line, action: run.action });
  };

const doingOf = (action: PackageAction): string =>
  action === "add" ? "adding packages" : "removing packages";

/** A run that does not reach its end: packages.done says so, then its failure is thrown. */
function ended(options: InstallOptions, run: Run, failure: unknown): never {
  const { names, action } = run;
  if (failure instanceof DaemonStopping)
    options.log.info(
      { names, action },
      action === "add"
        ? "an install was stopped with the daemon"
        : "a removal was stopped with the daemon",
    );
  const message = failure instanceof Error ? failure.message : String(failure);
  if (!(failure instanceof DaemonStopping))
    options.log[failure instanceof PackagesCancelled ? "info" : "error"](
      { names, action },
      `${doingOf(action)} failed: ${message}`,
    );
  const errorName = failure instanceof JsnbError ? failure.name : undefined;
  options.bus.emit("", "packages.done", {
    names: [...names],
    ok: false,
    error: message,
    ...(errorName === undefined ? {} : { errorName }),
    action,
  });
  throw failure;
}

/** A run packages.cancel took off the queue before its turn: packages.done says so, and its failure is answered. */
export function cancelledBeforeRun(
  options: InstallOptions,
  run: { readonly names: readonly string[]; readonly action: PackageAction },
): PackagesCancelled {
  const manager = managerFor(options.root, options.settings()["packages.manager"]);
  const failure = new PackagesCancelled({
    names: run.names,
    manager,
    action: run.action,
    started: false,
  });
  options.bus.emit("", "packages.done", {
    names: [...run.names],
    ok: false,
    error: failure.message,
    errorName: failure.name,
    action: run.action,
  });
  return failure;
}

/** Refuses a name packages.remove got that is no package name (one that would read as an option) or that
 * package.json does not declare: no manager runs for it. */
export async function checkRemovable(root: string, names: readonly string[]): Promise<void> {
  checkSpecs(names);
  const declared = new Set((await declaredPackages(root)).map((each) => each.name));
  const issues = names.flatMap((name, index) =>
    declared.has(name)
      ? []
      : [{ path: ["names", index], message: `${name} is not a dependency in package.json` }],
  );
  if (issues.length > 0) throw new InvalidParams({ issues });
}

/** What runs before the manager: a stop or a cancel while queued ends the run, so no manager starts only to be
 * killed; an add makes sure package.json exists. Returns the manager to run. */
async function prepareRun(options: InstallOptions, run: Run): Promise<Manager> {
  // Queued behind a run the stop ended: nothing more runs, package.json untouched.
  if (options.stop.aborted) ended(options, run, new DaemonStopping({ names: run.names }));
  if (run.action === "add") await ensureManifest(options.root);
  const manager = managerFor(options.root, options.settings()["packages.manager"]);
  if (run.cancel.aborted)
    ended(
      options,
      run,
      new PackagesCancelled({ names: run.names, manager, action: run.action, started: false }),
    );
  return manager;
}

/** Runs the manager to its exit code; a stop, the timeout or a cancel ends the run. */
async function managerExit(
  options: InstallOptions,
  run: Run,
  manager: Manager,
  output: ManagerOutput,
): Promise<number | null> {
  const timeout = { signal: AbortSignal.timeout(options.timeoutMs), timeoutMs: options.timeoutMs };
  try {
    const signal = AbortSignal.any([options.stop, timeout.signal, run.cancel]);
    const onLine = progressOf(options, run, output);
    options.log.info({ names: run.names, manager }, doingOf(run.action));
    const args = (run.action === "add" ? addArgs : removeArgs)(manager, run.names);
    const code = await runManager({ command: manager, args, cwd: options.root, signal, onLine });
    run.past();
    return code;
  } catch (error) {
    ended(options, run, whyNotRun(error, { ...run, manager, stop: options.stop }, timeout));
  }
}

/** A manager that exited non-zero ends the run with what its output says went wrong and how to fix it. */
function notDone(
  options: InstallOptions,
  run: Run,
  failed: {
    readonly manager: Manager;
    readonly output: ManagerOutput;
    readonly code: number | null;
  },
): never {
  const reason = failed.output.reason();
  const remedy = remedyFor(failed.output.block());
  const failure = {
    names: run.names,
    manager: failed.manager,
    exitCode: failed.code,
    output: failed.output.tail(5),
    ...(reason === undefined ? {} : { reason }),
    ...(remedy === undefined ? {} : { remedy }),
  };
  const NotDone = run.action === "add" ? PackagesNotAdded : PackagesNotRemoved;
  ended(options, run, new NotDone(failure));
}

/** Runs the manager for `run` to its end, or throws why it did not (packages.done sent either way but on success). */
async function runToEnd(options: InstallOptions, run: Run): Promise<void> {
  const manager = await prepareRun(options, run);
  const output = new ManagerOutput();
  const code = await managerExit(options, run, manager, output);
  if (code !== 0) notDone(options, run, { manager, output, code });
  options.log.info(
    { names: run.names },
    run.action === "add" ? "packages added" : "packages removed",
  );
  options.bus.emit("", "packages.done", { names: [...run.names], ok: true, action: run.action });
}

/** Refuses a local spec that names no package folder or tarball: no manager runs for it. */
async function checkLocal(root: string, names: readonly string[]): Promise<void> {
  const problems = await Promise.all(
    names.map((name) =>
      isLocalSpec(name) ? localProblem(root, name) : Promise.resolve(undefined),
    ),
  );
  const issues = problems.flatMap((message, index) =>
    message === undefined ? [] : [{ path: ["names", index], message }],
  );
  if (issues.length > 0) throw new InvalidParams({ issues });
}

/** packages.add: the added packages with their installed versions; a local one by the name its package.json gives. */
export async function addPackages(
  options: InstallOptions,
  names: readonly string[],
  control: RunControl,
): Promise<DeclaredPackage[]> {
  checkSpecs(names);
  await checkLocal(options.root, names);
  await runToEnd(options, { action: "add", names, ...control });
  return Promise.all(
    names.map(async (spec) => {
      const name = isLocalSpec(spec)
        ? ((await localPackageName(options.root, spec)) ?? spec)
        : nameOf(spec);
      return { name, version: (await installedVersion(options.root, name)) ?? "" };
    }),
  );
}

/** packages.remove: the names removed, each one package.json declared. */
export async function removePackages(
  options: InstallOptions,
  names: readonly string[],
  control: RunControl,
): Promise<string[]> {
  await checkRemovable(options.root, names); // again at its turn: a run before it may have removed one
  await runToEnd(options, { action: "remove", names, ...control });
  return [...names];
}
