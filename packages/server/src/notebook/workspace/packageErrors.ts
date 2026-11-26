// The failures of packages.add and packages.remove: a package manager that is not installed, one killed
// past the install timeout, one a packages.cancel stopped, and one that ended without doing what it was asked.
import { JsnbError } from "@jsnb/core";

import type { Manager } from "../../files/packages/manager.js";

/** What a packages.progress or packages.done is about. */
export type PackageAction = "add" | "remove";

/** The package manager the setting or the lockfile names is not installed (spawn found no such command). */
export class PackageManagerMissing extends JsnbError {
  declare readonly data: { readonly manager: Manager };
  constructor(data: { readonly manager: Manager }, options: { readonly cause?: unknown } = {}) {
    super({
      name: "PackageManagerMissing",
      message: `${data.manager} is not installed (not on PATH). Install it, or set packages.manager to a package manager you have.`,
      data,
      ...options,
    });
  }
}

const verbOf = (action: PackageAction) => (action === "add" ? "adding" : "removing");

/** The package manager ran past the install timeout and was killed. */
export class PackagesTimedOut extends JsnbError {
  declare readonly data: {
    readonly names: readonly string[];
    readonly manager: Manager;
    readonly timeoutMs: number;
    readonly action: PackageAction;
  };
  constructor(data: PackagesTimedOut["data"], options: { readonly cause?: unknown } = {}) {
    super({
      name: "PackagesTimedOut",
      message: `${data.manager} did not finish ${verbOf(data.action)} ${data.names.join(" ")} within ${String(data.timeoutMs / 1000)} s and was stopped. Check the network or the registry, then try again.`,
      data,
      ...options,
    });
  }
}

/** The message of a cancel: a run whose manager started may have written part of its work; a queued one wrote nothing. */
function cancelMessage(data: PackagesCancelled["data"]): string {
  const doing = `${verbOf(data.action).replace(/^./u, (first) => first.toUpperCase())} ${data.names.join(" ")}`;
  return data.started
    ? `${doing} was cancelled and ${data.manager} stopped. What it wrote before stays: run the same command again to finish it.`
    : `${doing} was cancelled before ${data.manager} ran; nothing was installed or removed.`;
}

/** A packages.cancel stopped the run: `started` when its manager ran, and what it wrote before it was stopped
 * stays; a queued run cancelled changed nothing. */
export class PackagesCancelled extends JsnbError {
  declare readonly data: {
    readonly names: readonly string[];
    readonly manager: Manager;
    readonly action: PackageAction;
    readonly started: boolean;
  };
  constructor(data: PackagesCancelled["data"], options: { readonly cause?: unknown } = {}) {
    super({ name: "PackagesCancelled", message: cancelMessage(data), data, ...options });
  }
}

type Failure = {
  readonly names: readonly string[];
  readonly manager: Manager;
  readonly exitCode: number | null;
  readonly output: string;
  /** The manager's first error block on one line. */
  readonly reason?: string;
  readonly remedy?: string;
};

function failureMessage(verb: "add" | "remove", data: Failure): string {
  const head = `${data.manager} could not ${verb} ${data.names.join(" ")}`;
  if (data.reason === undefined)
    return `${head} (exit code ${String(data.exitCode)}). Its output ends with: ${data.output}`;
  return `${head}: ${data.reason}.${data.remedy === undefined ? "" : ` ${data.remedy}`}`;
}

/** The package manager ended without adding the packages. */
export class PackagesNotAdded extends JsnbError {
  declare readonly data: Failure;
  constructor(data: Failure) {
    super({
      name: "PackagesNotAdded",
      message: failureMessage("add", data),
      data,
    });
  }
}

/** The package manager ended without removing the packages. */
export class PackagesNotRemoved extends JsnbError {
  declare readonly data: Failure;
  constructor(data: Failure) {
    super({
      name: "PackagesNotRemoved",
      message: failureMessage("remove", data),
      data,
    });
  }
}
