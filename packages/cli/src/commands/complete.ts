// What the CLI adds to the flags before a call (03-api §8, §4.7): the default notebook when -n was left out (opened
// first when this command started the daemon), a secret's value from stdin (or asked for, unechoed, on a terminal),
// and the y/N question of a destructive command. A question not answered sends nothing: no, an empty answer or the end
// of input is Cancelled (exit 0), Ctrl-C at the raw-mode secret prompt Interrupted (exit 130).
import type { AnyCommand } from "@jsnb/core";

import {
  defaultNotebook,
  notebookArgument,
  openedByStart,
  presetNotebook,
} from "../daemon/notebook.js";
import { findWorkspace } from "../daemon/workspace.js";
import type { Session } from "../daemon/session.js";
import { Cancelled, Interrupted } from "../errors/cli.js";
import type { Io } from "../io/io.js";
import { flagsOf } from "./flags.js";
import { wordsOf } from "./names.js";
import { validate } from "./parse.js";
import type { Answer } from "./stdin.js";
import { ask, readAll } from "./stdin.js";

/** A piped secret loses the one line ending `echo` or a file adds. */
const withoutLineEnd = (text: string): string => text.replace(/\r?\n$/, "");

/** The text of an answer; anything but a line is the command's end. */
function answered(answer: Answer, command: AnyCommand): string {
  if (answer.kind === "interrupted") throw new Interrupted({ command: command.name });
  if (answer.kind === "end") throw new Cancelled({ command: command.name });
  return answer.text;
}

async function secretOf(
  io: Io,
  command: AnyCommand,
  key: string,
  input: Readonly<Record<string, unknown>>,
): Promise<string> {
  const name = typeof input.name === "string" ? input.name : key;
  const text = io.isTTY
    ? answered(
        await ask(io.stdin, io.stderr, `Value for ${name} (not shown): `, { echo: false }),
        command,
      )
    : withoutLineEnd(await readAll(io.stdin));
  // An empty value would blank the secret: an empty pipe or a bare Enter is no answer.
  if (text === "") throw new Cancelled({ command: command.name });
  return text;
}

/**
 * The flags' input before any daemon is found or started: its notebook paths read from the workspace root (-n, else
 * NIMBO_NOTEBOOK; the notebook domain's --path and rename's --to), so one outside the workspace starts nothing, then its secret,
 * asked, so a cancel starts nothing either.
 */
export async function beforeSession(
  command: AnyCommand,
  given: Readonly<Record<string, unknown>>,
  io: Io,
): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = { ...given };
  const words = wordsOf(command);
  for (const flag of flagsOf(command)) {
    const value = input[flag.key];
    if (flag.type !== "path") continue;
    if (flag.key === "notebook") {
      const preset = await presetNotebook(io, typeof value === "string" ? value : undefined, words);
      if (preset !== undefined) input.notebook = preset;
    } else if (typeof value === "string") {
      const workspace = await findWorkspace(io.cwd);
      input[flag.key] = await notebookArgument(workspace, value, {
        argument: `--${flag.flag}`,
        command: words,
      });
    }
  }
  for (const flag of flagsOf(command)) {
    if (flag.kind === "secret" && !(flag.key in input)) {
      input[flag.key] = await secretOf(io, command, flag.key, input);
    }
  }
  return input;
}

/** The full input: the notebook defaulted when none was named (opened after a start); checked again. */
export async function completeInput(
  command: AnyCommand,
  given: Readonly<Record<string, unknown>>,
  session: Session,
): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = { ...given };
  if (flagsOf(command).some((flag) => flag.key === "notebook")) {
    const named = typeof input.notebook === "string" ? input.notebook : undefined;
    input.notebook = await openedByStart(session, named ?? (await defaultNotebook(session)));
  }
  validate(command, input);
  return input;
}

/** Asks before a destructive command on a terminal: y or yes goes on; anything else is Cancelled, nothing sent. */
export async function confirm(io: Io, command: AnyCommand): Promise<void> {
  const question = `nimbo ${wordsOf(command)}: ${command.description} Continue? [y/N] `;
  const answer = answered(await ask(io.stdin, io.stderr, question, { echo: true }), command);
  if (!/^y(es)?$/i.test(answer.trim())) throw new Cancelled({ command: command.name });
}

/** Asks before sending a command again that its refusal said needs the explicit yes (`confirm`). */
export async function confirmAfter(io: Io, command: AnyCommand, why: string): Promise<void> {
  const question = `nimbo ${wordsOf(command)}: ${why.split("\n")[0] ?? why}. Continue? [y/N] `;
  const answer = answered(await ask(io.stdin, io.stderr, question, { echo: true }), command);
  if (!/^y(es)?$/i.test(answer.trim())) throw new Cancelled({ command: command.name });
}
