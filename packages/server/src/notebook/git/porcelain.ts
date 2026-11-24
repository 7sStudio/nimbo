// The output of `git status --porcelain=v2 --branch -z` (git-status(1)): `# branch.*` headers, then one record per
// changed path: `1` ordinary, `2` renamed or copied (its old path in the next NUL-separated field), `u` unmerged,
// `?` untracked; X is the index's state of the path and Y the working tree's, `.` for unchanged.
import type { GitBranch } from "@jsnb/core";

export type PorcelainEntry = {
  readonly kind: "1" | "2" | "u" | "?";
  readonly path: string;
  readonly from?: string;
  readonly x: string;
  readonly y: string;
};

/** The fields before the path in each kind of record. */
const fieldsBeforePath = { "1": 8, "2": 9, u: 10 } as const;

const recordOf = (
  kind: "1" | "2" | "u",
  field: string,
  from: string | undefined,
): PorcelainEntry => {
  const parts = field.split(" ");
  const xy = parts[1] ?? "..";
  const path = parts.slice(fieldsBeforePath[kind]).join(" ");
  return { kind, path, x: xy[0] ?? ".", y: xy[1] ?? ".", ...(from === undefined ? {} : { from }) };
};

export function parsePorcelain(text: string): {
  readonly headers: ReadonlyMap<string, string>;
  readonly entries: readonly PorcelainEntry[];
} {
  const fields = text.split("\0");
  const headers = new Map<string, string>();
  const entries: PorcelainEntry[] = [];
  for (let at = 0; at < fields.length; at += 1) {
    const field = fields[at] ?? "";
    const kind = field[0];
    if (kind === "#") {
      const [, key = "", ...rest] = field.split(" ");
      headers.set(key, rest.join(" "));
    } else if (kind === "?") entries.push({ kind, path: field.slice(2), x: "?", y: "?" });
    else if (kind === "1" || kind === "u") entries.push(recordOf(kind, field, undefined));
    else if (kind === "2") {
      at += 1;
      entries.push(recordOf(kind, field, fields[at] ?? ""));
    }
  }
  return { headers, entries };
}

/** A header's value, or null when it is missing or git's placeholder (`(initial)`, `(detached)`). */
const headerOf = (headers: ReadonlyMap<string, string>, key: string): string | null => {
  const value = headers.get(key);
  return value === undefined || value.startsWith("(") ? null : value;
};

export function branchOf(headers: ReadonlyMap<string, string>): GitBranch {
  const name = headerOf(headers, "branch.head");
  const [ahead = "0", behind = "0"] =
    /^\+(\d+) -(\d+)$/u.exec(headers.get("branch.ab") ?? "")?.slice(1) ?? [];
  return {
    name,
    oid: headerOf(headers, "branch.oid"),
    detached: name === null,
    upstream: headerOf(headers, "branch.upstream"),
    ahead: Number(ahead),
    behind: Number(behind),
  };
}
