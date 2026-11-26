// The captured `console` of a run: our own object, never the real console; Node's line formats.
import { formatArgs } from "./format.js";
import { consoleInspect, inspect } from "./inspect.js";
import type { StreamName } from "./streams.js";

/** Where a run's console writes: its streams, and the clock for `console.time`. */
export type ConsoleSink = {
  readonly write: (stream: StreamName, text: string) => void;
  readonly now: () => number;
};

type Method = (...args: unknown[]) => void;
type Print = (stream: StreamName, text: string) => void;

const labelOf = (label: unknown): string => (label === undefined ? "default" : formatArgs([label]));

/** Each line of `text` indented two spaces per open group, ending in a newline. */
const indented = (text: string, groups: number): string => {
  const pad = "  ".repeat(groups);
  return `${text
    .split("\n")
    .map((line) => pad + line)
    .join("\n")}\n`;
};

/** `count` and `countReset`: `label: n`, the label `default` when none is given. */
function counts(print: Print): Readonly<Record<string, Method>> {
  const byLabel = new Map<string, number>();
  return {
    count: (label) => {
      const name = labelOf(label);
      const next = (byLabel.get(name) ?? 0) + 1;
      byLabel.set(name, next);
      print("stdout", `${name}: ${String(next)}`);
    },
    countReset: (label) => {
      const name = labelOf(label);
      if (byLabel.has(name)) byLabel.set(name, 0);
      else print("stderr", `Count for '${name}' does not exist`);
    },
  };
}

/** `time`, `timeLog`, `timeEnd`: `label: 1.234ms` from the run's clock, Node's warning for an unknown label. */
function timers(print: Print, now: () => number): Readonly<Record<string, Method>> {
  const started = new Map<string, number>();
  const report = (label: unknown, method: string, extra: readonly unknown[]): void => {
    const name = labelOf(label);
    const start = started.get(name);
    if (start === undefined) {
      print("stderr", `Warning: No such label '${name}' for console.${method}()`);
      return;
    }
    if (method === "timeEnd") started.delete(name);
    const line = `${name}: ${(now() - start).toFixed(3)}ms`;
    print("stdout", extra.length > 0 ? `${line} ${formatArgs(extra)}` : line);
  };
  return {
    time: (label) => {
      started.set(labelOf(label), now());
    },
    timeLog: (label, ...extra) => {
      report(label, "timeLog", extra);
    },
    timeEnd: (label) => {
      report(label, "timeEnd", []);
    },
  };
}

/** `log`, `warn` and the rest that print their arguments; `assert` prints only when the assertion fails. */
function printers(print: Print): Readonly<Record<string, Method>> {
  const out: Method = (...args) => {
    print("stdout", formatArgs(args));
  };
  const err: Method = (...args) => {
    print("stderr", formatArgs(args));
  };
  const titled = (title: string, args: readonly unknown[]): string =>
    args.length > 0 ? `${title}: ${formatArgs(args)}` : title;
  return {
    log: out,
    info: out,
    debug: out,
    table: out,
    warn: err,
    error: err,
    dir: (value) => {
      print("stdout", inspect(value, consoleInspect));
    },
    trace: (...args) => {
      print("stderr", titled("Trace", args));
    },
    assert: (condition, ...args) => {
      if (!condition) print("stderr", titled("Assertion failed", args));
    },
  };
}

/** The methods a notebook uses; anything else is absent. Every method is an arrow, so `const { log } = console` works. */
export function createConsole(sink: ConsoleSink): Readonly<Record<string, Method>> {
  let groups = 0;
  const print: Print = (stream, text) => {
    sink.write(stream, indented(text, groups));
  };
  const plain = printers(print);
  const group: Method = (...args) => {
    if (args.length > 0) plain.log?.(...args);
    groups += 1;
  };
  const groupEnd: Method = () => {
    groups = Math.max(0, groups - 1);
  };
  return {
    ...plain,
    group,
    groupCollapsed: group,
    groupEnd,
    ...counts(print),
    ...timers(print, sink.now),
  };
}
