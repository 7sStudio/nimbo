// The Source Control outputs read as a terminal's git prints them: the log one commit a line, the branches with their
// upstream and counts, the stashes as git stash list, a pull's strategy and result, a commit's files.
import {
  gitBranches,
  gitLog,
  gitPull,
  gitShow,
  gitStashList,
  gitSync,
  type GitPullOutcome,
} from "@jsnb/core";

const day = (date: string): string => date.slice(0, 10);

const counts = (ahead: number, behind: number): string =>
  [ahead > 0 ? `↑${String(ahead)}` : "", behind > 0 ? `↓${String(behind)}` : ""]
    .filter(Boolean)
    .join(" ");

function pullLine(pull: GitPullOutcome): string {
  const how = pull.strategy === "fastForwardOnly" ? "fast-forward only" : pull.strategy;
  if (pull.result !== "conflicts") return `Pulled (${how}): ${pull.result}.\n`;
  return [
    `Pulled (${how}): stopped on conflicts in`,
    ...pull.conflicts.map((path) => `  ${path}`),
    "Resolve and commit (nimbo git continue), or nimbo git abort --yes.",
  ]
    .join("\n")
    .concat("\n");
}

const renderers: Readonly<Record<string, (output: unknown) => string | undefined>> = {
  "git.log": (output) => {
    const parsed = gitLog.output.safeParse(output);
    if (!parsed.success) return undefined;
    const lines = parsed.data.commits.map(
      (commit) => `${commit.short} ${day(commit.date)} ${commit.author}  ${commit.subject}`,
    );
    if (parsed.data.more) lines.push("… more with --skip");
    return lines.length === 0 ? "No commits.\n" : `${lines.join("\n")}\n`;
  },
  "git.branches": (output) => {
    const parsed = gitBranches.output.safeParse(output);
    if (!parsed.success) return undefined;
    const local = parsed.data.local.map((branch) => {
      const track =
        branch.upstream === null ? "" : ` → ${branch.upstream}${branch.gone ? " (gone)" : ""}`;
      const moved = counts(branch.ahead, branch.behind);
      return `${branch.current ? "*" : " "} ${branch.name}${track}${moved === "" ? "" : ` ${moved}`}  ${branch.subject}`;
    });
    const remote = parsed.data.remote.map((branch) => `  ${branch.name}  ${branch.subject}`);
    return `${[...local, ...(remote.length > 0 ? ["", ...remote] : [])].join("\n")}\n`;
  },
  "git.stashList": (output) => {
    const parsed = gitStashList.output.safeParse(output);
    if (!parsed.success) return undefined;
    const lines = parsed.data.stashes.map(
      (stash) => `stash@{${String(stash.index)}} ${day(stash.date)} ${stash.message}`,
    );
    return lines.length === 0 ? "No stashes.\n" : `${lines.join("\n")}\n`;
  },
  "git.pull": (output) => {
    const parsed = gitPull.output.safeParse(output);
    return parsed.success ? pullLine(parsed.data) : undefined;
  },
  "git.sync": (output) => {
    const parsed = gitSync.output.safeParse(output);
    if (!parsed.success) return undefined;
    return `${pullLine(parsed.data.pull)}${parsed.data.pushed ? "Pushed.\n" : ""}`;
  },
  "git.show": (output) => {
    const parsed = gitShow.output.safeParse(output);
    if (!parsed.success) return undefined;
    const commit = parsed.data;
    const files = commit.files.map(
      (file) =>
        `  ${file.status.padEnd(9)} ${file.from === undefined ? "" : `${file.from} → `}${file.path}`,
    );
    const outside =
      commit.outside > 0 ? [`  and ${String(commit.outside)} outside this folder`] : [];
    const body = commit.body === "" ? [] : ["", commit.body];
    return `${[`${commit.short} ${commit.author} ${day(commit.date)}`, commit.subject, ...body, "", ...files, ...outside].join("\n")}\n`;
  },
};

/** The text of a Source Control output, or undefined for one read as an outline. */
export const gitText = (name: string, output: unknown): string | undefined =>
  renderers[name]?.(output);
