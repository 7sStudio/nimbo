// The bottom panel's Console: every line the cells printed, from the server
// kernel and from the page, one row per line, as the runs the mirror follows hold them: a stream output's lines
// (stdout as "output"; stderr, where console.error and console.warn write, as "error output", which says where it was
// written, not that anything failed) and the errors thrown after a run ended ("uncaught"). A line that arrived while this page was open has the time it arrived; one that was there when
// the page loaded has its run's start, and says so. Clear hides what is there now; the log keeps its last 1,000 lines.
import type { CellId, Execution, Output } from "@jsnb/core";
import { defineStore } from "pinia";
import { shallowRef, watch } from "vue";

import { useNotebookStore } from "./notebook.js";

export type ConsoleLevel = "output" | "error output" | "uncaught";

export type ConsoleLine = {
  readonly key: string;
  /** ISO time: when the line arrived, or its run's start for a line the page found on load (`arrived` false). */
  readonly at: string;
  readonly arrived: boolean;
  readonly level: ConsoleLevel;
  readonly cell: CellId;
  readonly text: string;
};

const kept = 1000;

/** The lines one output holds: a stream's text line by line (its last line break ends a line, it adds none), an error's
 * name and message; nothing for the other kinds. */
function textsOf(output: Output): readonly { level: ConsoleLevel; text: string }[] {
  if (output.kind === "error")
    return [{ level: "uncaught", text: `${output.error.name}: ${output.error.message}` }];
  if (output.kind !== "stream") return [];
  const level = output.stream === "stderr" ? "error output" : "output";
  const lines = output.text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((text) => ({ level, text }));
}

/** The lines of `execution`'s outputs not in the log yet (`counted` says how many of each run's are), `now` their time
 * when they arrived while the page was open (`loaded`), else the run's start. */
function newLines(
  counted: Map<string, number>,
  execution: Execution,
  { now, loaded }: { readonly now: string; readonly loaded: boolean },
): ConsoleLine[] {
  const from = counted.get(execution.id);
  counted.set(execution.id, Math.max(from ?? 0, execution.outputs.length));
  // a run first met with its outputs already there, on load, has only its start for a time
  const arrived = loaded && (from !== undefined || execution.outputs.length === 0);
  return execution.outputs.slice(from ?? 0).flatMap((output, offset) =>
    textsOf(output).map(({ level, text }, line) => ({
      key: `${execution.id}:${String((from ?? 0) + offset)}:${String(line)}`,
      at: arrived ? now : execution.startedAt,
      arrived,
      level,
      cell: execution.cell,
      text,
    })),
  );
}

export const useConsoleStore = defineStore("console", () => {
  const notebook = useNotebookStore();
  const lines = shallowRef<readonly ConsoleLine[]>([]);
  /** How many outputs of each run are in the log already. */
  const counted = new Map<string, number>();
  const seen = new WeakSet<Execution>();
  let loaded = false;

  // Side effect: the outputs the mirror's runs gain become lines; a run the mirror replaces is read again for its rest.
  watch(
    () => notebook.mirror.executions,
    (executions) => {
      const now = new Date().toISOString();
      const added = [...executions.values()]
        .filter((execution) => !seen.has(execution))
        .flatMap((execution) => {
          seen.add(execution);
          return newLines(counted, execution, { now, loaded });
        });
      if (added.length > 0) lines.value = [...lines.value, ...added].slice(-kept);
      if (notebook.mirror.notebook !== null) loaded = true;
    },
    { immediate: true },
  );
  return {
    lines,
    clear: () => {
      lines.value = [];
    },
  };
});
