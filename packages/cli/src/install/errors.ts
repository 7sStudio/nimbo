// The install commands' failures as a person reads them: what failed, then what to do. A file-system or network error
// from Node (EACCES, ENOSPC, ECONNREFUSED, a timeout) becomes one of these, so no errno or stack reaches the user.
import { JsnbError, productName } from "@jsnb/core";

/** Something the install, upgrade or uninstall could not do, and the next step. */
export class InstallFailed extends JsnbError {
  declare readonly data: {
    readonly what: string;
    readonly todo: string;
    readonly details: readonly string[];
  };
  constructor(
    data: { readonly what: string; readonly todo: string; readonly details?: readonly string[] },
    options: { cause?: unknown } = {},
  ) {
    const full = { what: data.what, todo: data.todo, details: data.details ?? [] };
    super({ name: "InstallFailed", message: `${data.what} ${data.todo}`, data: full, ...options });
  }
}

/** Another install, upgrade, uninstall or DuckDB install holds the data folder's lock. */
export class InstallBusy extends JsnbError {
  declare readonly data: {
    readonly pid: number;
    readonly command: string;
    readonly lock: string;
    readonly what: string;
    readonly todo: string;
    readonly details: readonly string[];
  };
  constructor(data: { readonly pid: number; readonly command?: string; readonly lock: string }) {
    const command = data.command ?? "";
    const what = `Another ${productName} install or upgrade is running (process ${String(data.pid)}${command === "" ? "" : `: ${command}`}).`;
    const todo = `Wait for it to finish, then try again. If none is running, remove the lock: rm -r '${data.lock.replaceAll("'", "'\\''")}'`;
    super({
      name: "InstallBusy",
      message: `${what} ${todo}`,
      data: { pid: data.pid, command, lock: data.lock, what, todo, details: [] },
    });
  }
}

const codeOf = (error: unknown): string =>
  error instanceof Error ? String(Reflect.get(error, "code") ?? "") : "";

const reasons: Readonly<Record<string, readonly [string, string]>> = {
  EACCES: ["permission was denied", "Check that you own the folder, then try again."],
  EPERM: ["the operation was not permitted", "Check that you own the folder, then try again."],
  EROFS: ["the disk is read-only", "Install to a writable disk."],
  ENOSPC: ["the disk is full", "Free some space, then try again."],
  EDQUOT: ["the disk quota is used up", "Free some space, then try again."],
  ENOENT: ["a file was missing", "Try again; if it keeps failing, reinstall."],
  ENOTEMPTY: ["a folder was in use", "Try again once other installs have finished."],
  EEXIST: ["a folder was in use", "Try again once other installs have finished."],
  ECONNREFUSED: ["the server refused the connection", "Check the network or the releases URL."],
  ENOTFOUND: ["the server's name could not be found", "Check the network or the releases URL."],
  ECONNRESET: ["the connection was cut", "Try again."],
  ETIMEDOUT: ["the connection timed out", "Check the network, then try again."],
  TimeoutError: ["the server did not answer in time", "Check the network, then try again."],
};

/** `error` as InstallFailed: kept when it is one of ours already, else explained from its code. */
export function explained(error: unknown, what: string): JsnbError {
  if (error instanceof JsnbError) return error;
  const name = error instanceof Error ? error.name : "";
  const cause: unknown = error instanceof Error ? Reflect.get(error, "cause") : undefined;
  const reason = reasons[codeOf(error)] ?? reasons[name] ?? reasons[codeOf(cause)];
  return reason === undefined
    ? new InstallFailed(
        {
          what: `${what} failed.`,
          todo: `Try again; if it keeps failing, run ${productName} doctor.`,
        },
        { cause: error },
      )
    : new InstallFailed(
        { what: `${what} failed: ${reason[0]}.`, todo: reason[1] },
        { cause: error },
      );
}
