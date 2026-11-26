// The help of the generated surface: a domain's verbs, and a command's description (the registry's), its
// flags with type, default and whether each is required, and its tags. Golden snapshots hold every one.
import type { AnyCommand } from "@jsnb/core";

import type { Flag } from "./flags.js";
import { flagsOf } from "./flags.js";
import { commandsByDomain, verbOf, wordsOf } from "./names.js";

/** The widest first column the help pads to; a longer entry puts its text on the next line. */
const columnCap = 36;

/** The width a help line keeps to. */
const lineWidth = 118;

/** Two columns, the first padded to its widest entry up to columnCap, the second wrapped to lineWidth. */
export function columns(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.min(columnCap, Math.max(0, ...rows.map(([left]) => left.length)));
  const pad = " ".repeat(width + 4);
  return rows.flatMap(([left, right]) => {
    if (right === "") return [`  ${left}`];
    const text = wrapped(right.split(" "), pad, lineWidth).map((line) => line.slice(pad.length));
    const [first = "", ...rest] = text;
    const head =
      left.length > width ? [`  ${left}`, `${pad}${first}`] : [`  ${left.padEnd(width)}  ${first}`];
    return [...head, ...rest.map((line) => `${pad}${line}`)];
  });
}

/** Words wrapped into lines of at most `width` characters, each indented. */
function wrapped(words: readonly string[], indent: string, width = 100): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line === "" ? word : `${line} ${word}`;
    if (next.length + indent.length > width && line !== "") {
      lines.push(`${indent}${line}`);
      line = word;
    } else line = next;
  }
  return line === "" ? lines : [...lines, `${indent}${line}`];
}

const notebookDefault =
  "the notebook's path from the workspace root, whatever the working folder; defaults to NIMBO_NOTEBOOK, else the only open notebook, else the only .jsnb file";

function flagLabel(flag: Flag): string {
  const name = flag.short === undefined ? `--${flag.flag}` : `-${flag.short}, --${flag.flag}`;
  if (flag.kind === "boolean") return `${name}, --no-${flag.flag}`;
  if (flag.kind === "list") return `${name} <${flag.type}>...`;
  return `${name} <${flag.type}>`;
}

/** A flag's notes, in the order the help prints them: each says something or nothing (undefined). */
const noteRules: readonly ((flag: Flag) => string | undefined)[] = [
  (flag) => (flag.required && flag.key !== "notebook" ? "required" : undefined),
  (flag) => (flag.key === "notebook" ? notebookDefault : undefined),
  (flag) =>
    flag.defaults === undefined ? undefined : `default ${JSON.stringify(flag.defaults.value)}`,
  (flag) => (flag.kind === "list" ? "repeat for more" : undefined),
  (flag) =>
    flag.kind === "json"
      ? `takes ${flag.forms ?? "<any JSON>"} (JSON other than a string, else the text itself)`
      : undefined,
  (flag) =>
    flag.key !== "notebook" && flag.type === "path" ? "from the workspace root" : undefined,
  (flag) => (flag.kind === "source" ? "- reads stdin; or --file <path>" : undefined),
];

const flagNotes = (flag: Flag): string =>
  noteRules
    .map((rule) => rule(flag))
    .filter((note) => note !== undefined)
    .join("; ");

/** The flag lines of a command; a secret key is a note instead, since it is never a flag. */
function flagLines(command: AnyCommand): string[] {
  const flags = flagsOf(command);
  const rows = flags
    .filter((flag) => flag.kind !== "secret")
    .map((flag) => [flagLabel(flag), flagNotes(flag)] as const);
  const secrets = flags
    .filter((flag) => flag.kind === "secret")
    .map(
      (flag) =>
        `The ${flag.key} is read from stdin, or asked for on a terminal; it is never a flag.`,
    );
  const lists = flags.flatMap((flag) =>
    flag.values === undefined
      ? []
      : [`  <${flag.type}> is one of:`, ...wrapped(flag.values, "    ")],
  );
  return [...(rows.length === 0 ? ["  (none)"] : columns(rows)), ...lists, ...secrets];
}

/** `mutating, destructive, idempotent, streaming, planned`, or `read-only`. */
function tagsOf(command: AnyCommand): string {
  const { mutating, destructive, idempotent, streaming, planned } = command.tags;
  const named = Object.entries({ mutating, destructive, idempotent, streaming, planned })
    .filter(([, on]) => on)
    .map(([name]) => name);
  return mutating || destructive ? named.join(", ") : ["read-only", ...named].join(", ");
}

/** `nimbo <domain> <verb> --help`. */
export function commandHelp(command: AnyCommand): string {
  return [
    `nimbo ${wordsOf(command)}: ${command.description}`,
    "",
    `Usage: nimbo ${wordsOf(command)} [flags]`,
    "",
    "Flags:",
    ...flagLines(command),
    "",
    `Tags: ${tagsOf(command)}${command.tags.destructive ? " (asks y/N on a terminal; --yes skips it)" : ""}`,
    `Registry command: ${command.name}. Global flags: --json, --yes / -y, --help / -h.`,
    "",
  ].join("\n");
}

/** `nimbo <domain> --help`; undefined for a domain with no public command. */
export function domainHelp(domain: string): string | undefined {
  const commands = commandsByDomain().get(domain);
  if (commands === undefined) return undefined;
  return [
    `nimbo ${domain}: the ${domain} commands of the registry`,
    "",
    `Usage: nimbo ${domain} <verb> [flags]`,
    "",
    "Verbs:",
    ...columns(commands.map((command) => [verbOf(command), command.description])),
    "",
    `A verb is the registry's name in kebab-case (cell.outputQuery is nimbo cell output-query).`,
    `Run nimbo ${domain} <verb> --help for its flags.`,
    "",
  ].join("\n");
}
