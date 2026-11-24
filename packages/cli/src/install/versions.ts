// The installed versions side by side (02-architecture §10): which release an upgrade takes, and which old versions
// may go. A version some process still runs from (a daemon, its kernels, an agent's MCP server) is kept until it stops,
// since an upgrade under a running daemon would hand it new kernel code and new page chunks it never built.

type Parsed = { readonly core: readonly number[]; readonly pre: readonly string[] };

const parse = (version: string): Parsed | undefined => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(version);
  if (match === null) return undefined;
  const [, major = "", minor = "", patch = "", pre] = match;
  return {
    core: [Number(major), Number(minor), Number(patch)],
    pre: pre === undefined ? [] : pre.split("."),
  };
};

const comparePart = (a: string, b: string): number => {
  const numeric = /^\d+$/u;
  if (numeric.test(a) && numeric.test(b)) return Number(a) - Number(b);
  if (numeric.test(a)) return -1;
  if (numeric.test(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

const compareCore = (a: readonly number[], b: readonly number[]): number => {
  for (let index = 0; index < 3; index += 1) {
    const step = (a[index] ?? 0) - (b[index] ?? 0);
    if (step !== 0) return Math.sign(step);
  }
  return 0;
};

/** Prerelease identifiers in order; no identifiers (a release) sorts after any. */
const comparePre = (a: readonly string[], b: readonly string[]): number => {
  if (a.length === 0 || b.length === 0) return Math.sign(b.length - a.length);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined || right === undefined) return left === undefined ? -1 : 1;
    const step = comparePart(left, right);
    if (step !== 0) return Math.sign(step);
  }
  return 0;
};

/** Semantic-version order (a prerelease before its release); a version that is not one sorts first. */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  if (left === undefined || right === undefined) {
    return left === right ? 0 : left === undefined ? -1 : 1;
  }
  return compareCore(left.core, right.core) || comparePre(left.pre, right.pre);
}

/**
 * A version as a release names it and as a folder of `versions/` is named: digits and dots, and an optional
 * pre-release of letters, digits, dots and hyphens. No `v`, no build metadata, nothing a path could be built from.
 */
export const isReleaseVersion = (text: string): boolean =>
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/u.test(text) && !text.includes("..");

export type UpgradePlan =
  | { readonly kind: "current"; readonly version: string }
  | { readonly kind: "install"; readonly version: string };

/**
 * What an upgrade does: install the offered release when it is newer than the running one, or when it was asked for
 * by name (a downgrade or a repair included); otherwise nothing.
 */
export function planUpgrade(running: string, offered: string, asked: boolean): UpgradePlan {
  if (!asked && compareVersions(offered, running) <= 0)
    return { kind: "current", version: running };
  if (asked && offered === running) return { kind: "current", version: running };
  return { kind: "install", version: offered };
}

/** The versions to remove: every installed one but the current, kept while a process runs from it. */
export function staleVersions(
  installed: readonly string[],
  current: string,
  inUse: ReadonlySet<string>,
): { readonly remove: readonly string[]; readonly kept: readonly string[] } {
  const others = installed.filter((version) => version !== current);
  return {
    remove: others.filter((version) => !inUse.has(version)),
    kept: others.filter((version) => inUse.has(version)),
  };
}

/**
 * The version each process runs from: one whose executable is `<versions>/<v>/node/bin/node`, under any of the
 * spellings of the versions folder (as written and as resolved, since `ps` shows a path as it was invoked). A process
 * that only names a file in a version (an editor, `tail -f`) runs from none.
 */
export function versionsInUse(
  versionsDirs: readonly string[],
  commands: readonly { readonly pid: number; readonly command: string }[],
  ownPid: number,
): Map<string, number[]> {
  const prefixes = [...new Set(versionsDirs.map((dir) => `${dir.replace(/\/+$/u, "")}/`))];
  const found = new Map<string, number[]>();
  for (const { pid, command } of commands) {
    if (pid === ownPid) continue;
    for (const prefix of prefixes) {
      if (!command.startsWith(prefix)) continue;
      const match = /^([^/\s]+)\/node\/bin\/node(?:\s|$)/u.exec(command.slice(prefix.length));
      const version = match?.[1];
      if (version === undefined || !isReleaseVersion(version)) continue;
      found.set(version, [...(found.get(version) ?? []), pid]);
      break;
    }
  }
  return found;
}
