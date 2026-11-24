// How the install commands (upgrade, uninstall, doctor, mcp install, sql) talk to a person: headings, step lines with
// a state mark, aligned rows, callouts, commands to copy, a progress line, and the questions asked at a terminal.
// Colour follows colourOn; the marks fall back to ASCII outside a UTF-8 locale; without a terminal on both stdin and
// stdout, or under --yes or --json, nothing is asked and every question takes the answer the command passes as its
// fallback.
import type { Interface } from "node:readline";
import { createInterface } from "node:readline";

import { Cancelled, Interrupted } from "../errors/cli.js";
import { colourOn, painter, sgr } from "./colour.js";
import type { Io } from "./io.js";
import { write } from "./io.js";

type Tone = "ok" | "warn" | "fail" | "info";

const unicodeMarks = { ok: "✓", warn: "!", fail: "✗", info: "•", arrow: "→" } as const;
const asciiMarks = { ok: "+", warn: "!", fail: "x", info: "*", arrow: "->" } as const;
const toneColour = { ok: sgr.green, warn: sgr.yellow, fail: sgr.red, info: sgr.cyan } as const;

/** The locale's character set is UTF-8: LC_ALL, else LC_CTYPE, else LANG, as the C library reads them. */
export function unicodeOn(env: Readonly<Record<string, string | undefined>>): boolean {
  const locale = [env.LC_ALL, env.LC_CTYPE, env.LANG].find(
    (value) => value !== undefined && value !== "",
  );
  return locale !== undefined && /utf-?8/iu.test(locale);
}

type Choice = { readonly label: string; readonly hint?: string };
type Toggle = Choice & { readonly checked: boolean };

type Progress = {
  /** `done` bytes (or steps) out of the total given at the start. */
  readonly update: (done: number) => void;
  /** Ends the line with its final state. */
  readonly end: (tone: Tone, text: string, detail?: string) => Promise<void>;
};

export type Screen = {
  /** Questions are asked: stdin and stdout are terminals, and neither --yes nor --json was given. */
  readonly interactive: boolean;
  /** The terminal's width (80 when stdout is not one), for lines that stack rather than wrap. */
  readonly columns: number;
  /** Aborted by the first Ctrl-C while the screen is open; a second one ends the process as usual. */
  readonly signal: AbortSignal;
  readonly accent: (text: string) => string;
  readonly strong: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly toned: (tone: Tone, text: string) => string;
  readonly mark: (tone: Tone | "arrow") => string;
  /** `text` with every path under the home folder shown from `~`. */
  readonly path: (path: string) => string;
  readonly line: (text?: string) => Promise<void>;
  readonly heading: (text: string) => Promise<void>;
  readonly step: (tone: Tone, text: string, detail?: string) => Promise<void>;
  /** Key and value rows, the keys padded to one width, under an optional indent. */
  readonly rows: (rows: readonly (readonly [string, string])[], indent?: number) => Promise<void>;
  /** A command to copy, on its own indented line. */
  readonly command: (text: string, note?: string) => Promise<void>;
  /** A warning or error block: a marked title and indented lines. */
  readonly callout: (tone: Tone, title: string, lines?: readonly string[]) => Promise<void>;
  readonly confirm: (
    question: string,
    options: { readonly default: boolean; readonly fallback?: boolean },
  ) => Promise<boolean>;
  /** The index of the option chosen; Enter takes `default`. */
  readonly choose: (
    question: string,
    options: readonly Choice[],
    defaults: { readonly default: number; readonly fallback?: number },
  ) => Promise<number>;
  /** Which options are on after the person toggled them by number; Enter accepts. */
  readonly chooseMany: (question: string, options: readonly Toggle[]) => Promise<boolean[]>;
  readonly progress: (label: string, total: number, unit?: "bytes" | "steps") => Progress;
  readonly close: () => void;
};

export type ScreenOptions = { readonly yes?: boolean; readonly json?: boolean };

/** `path` as a word to paste in a shell: from `~` when under the home folder and plain, else single-quoted. */
export function shellWord(path: string, home: string): string {
  const plain = /^[\w@%+=:,./-]+$/u.test(path);
  if (plain && home !== "" && path.startsWith(`${home}/`))
    return `~/${path.slice(home.length + 1)}`;
  return plain ? path : `'${path.replaceAll("'", "'\\''")}'`;
}

/** Megabytes with one decimal under 10, else whole: `4.2 MB`, `45 MB`. */
export function megabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(1) : String(Math.round(mb))} MB`;
}

type Lines = { readonly next: () => Promise<string>; readonly close: () => void };

type Waiter = { resolve: (line: string) => void; reject: (error: Error) => void };

/** One readline over stdin for the whole screen, so answers typed ahead (or piped at once) are never lost. */
function lineQueue(io: Io, signal: AbortSignal, command: string): Lines {
  const state: { reader?: Interface; waiting?: Waiter | undefined; ended: boolean } = {
    ended: false,
  };
  const buffered: string[] = [];
  const settle = (fail: Error): void => {
    state.waiting?.reject(fail);
    state.waiting = undefined;
  };
  const open = (): void => {
    if (state.reader !== undefined) return;
    const reader = createInterface({ input: io.stdin, terminal: false });
    state.reader = reader;
    reader.on("line", (text) => {
      const pending = state.waiting;
      state.waiting = undefined;
      if (pending === undefined) buffered.push(text);
      else pending.resolve(text);
    });
    reader.on("close", () => {
      state.ended = true;
      settle(new Cancelled({ command }));
    });
  };
  signal.addEventListener("abort", () => {
    settle(new Interrupted({ command }));
  });
  const next = (): Promise<string> => {
    open();
    const ready = buffered.shift();
    if (ready !== undefined) return Promise.resolve(ready);
    if (signal.aborted) return Promise.reject(new Interrupted({ command }));
    if (state.ended) return Promise.reject(new Cancelled({ command }));
    return new Promise((resolve, reject) => {
      state.waiting = { resolve, reject };
    });
  };
  return { next, close: () => state.reader?.close() };
}

const columnsOf = (io: Io): number => {
  const columns: unknown = Reflect.get(io.stdout, "columns");
  return typeof columns === "number" && columns > 20 ? columns : 80;
};

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

type Style = Pick<Screen, "accent" | "strong" | "dim" | "toned" | "mark" | "path"> & {
  readonly unicode: boolean;
};

function styleOf(io: Io, json: boolean): Style {
  const paint = painter(!json && colourOn(io, "stdout"));
  const unicode = unicodeOn(io.env);
  const marks = unicode ? unicodeMarks : asciiMarks;
  const dim = (text: string): string => paint(sgr.dim, text);
  const toned = (tone: Tone, text: string): string => paint(toneColour[tone], text);
  const home = io.env.HOME ?? "";
  return {
    unicode,
    accent: (text) => paint(sgr.cyan, text),
    strong: (text) => paint(sgr.bold, text),
    dim,
    toned,
    mark: (tone) => (tone === "arrow" ? dim(marks.arrow) : toned(tone, marks[tone])),
    path: (value) =>
      home === "" || home === "/"
        ? value
        : value
            .split(`${home}/`)
            .join("~/")
            .replace(new RegExp(`^${escaped(home)}$`, "u"), "~"),
  };
}

type Out = (text: string) => Promise<void>;
type Questions = Pick<Screen, "confirm" | "choose">;

const listed = (
  style: Style,
  options: readonly Choice[],
  prefix: (index: number) => string,
): string => {
  const width = Math.max(...options.map((option) => option.label.length));
  return options
    .map(
      (option, index) =>
        `  ${style.accent(`${String(index + 1)})`)} ${prefix(index)}${
          option.hint === undefined
            ? option.label
            : `${option.label.padEnd(width)}  ${style.dim(option.hint)}`
        }\n`,
    )
    .join("");
};

/** The numbers a person typed (`1 3`, `1,3`), as indexes, or undefined when one is out of range. */
const numbers = (answer: string, count: number): number[] | undefined => {
  const picked = answer.split(/[\s,]+/u).map((word) => Number(word) - 1);
  return picked.every((index) => Number.isInteger(index) && index >= 0 && index < count)
    ? picked
    : undefined;
};

function questions(out: Out, style: Style, lines: Lines, interactive: boolean): Questions {
  const ask = (text: string, suffix = ""): Promise<void> =>
    out(
      `${style.accent("?")} ${style.strong(text)}${suffix === "" ? "" : ` ${style.dim(suffix)}`} `,
    );
  const hint = (text: string): Promise<void> => out(`  ${style.dim(text)}\n`);
  return {
    confirm: async (text, { default: yes, fallback = yes }) => {
      if (!interactive) return fallback;
      for (;;) {
        await ask(text, yes ? "(Y/n)" : "(y/N)");
        const answer = (await lines.next()).trim().toLowerCase();
        if (answer === "") return yes;
        if (answer === "y" || answer === "yes") return true;
        if (answer === "n" || answer === "no") return false;
        await hint("Type y or n.");
      }
    },
    choose: async (text, options, { default: first, fallback = first }) => {
      if (!interactive) return fallback;
      await out(`${style.accent("?")} ${style.strong(text)}\n${listed(style, options, () => "")}`);
      for (;;) {
        await out(`  ${style.dim(`Enter for ${String(first + 1)}, or type a number:`)} `);
        const answer = (await lines.next()).trim();
        if (answer === "") return first;
        const [index] = numbers(answer, options.length) ?? [];
        if (index !== undefined) return index;
        await hint(`Type a number from 1 to ${String(options.length)}.`);
      }
    },
  };
}

function toggles(out: Out, style: Style, lines: Lines, interactive: boolean): Screen["chooseMany"] {
  const hint = (text: string): Promise<void> => out(`  ${style.dim(text)}\n`);
  return async (text, options) => {
    const on = options.map((option) => option.checked);
    if (!interactive) return on;
    await out(`${style.accent("?")} ${style.strong(text)}\n`);
    for (;;) {
      await out(
        listed(
          style,
          options,
          (index) => `${on[index] === true ? style.toned("ok", "[x]") : "[ ]"} `,
        ),
      );
      await out(`  ${style.dim("Type numbers to switch them on or off, or Enter to continue:")} `);
      const answer = (await lines.next()).trim();
      if (answer === "") return on;
      const picked = numbers(answer, on.length);
      if (picked === undefined) await hint(`Type numbers from 1 to ${String(options.length)}.`);
      for (const index of picked ?? []) on[index] = on[index] !== true;
    }
  };
}

const stepLine = (style: Style, tone: Tone, text: string, detail?: string): string =>
  `  ${style.mark(tone)} ${text}${detail === undefined || detail === "" ? "" : `  ${style.dim(detail)}`}\n`;

/** A progress line redrawn in place on a terminal (and nothing elsewhere), then its final step line. */
function progressOf(io: Io, style: Style, live: boolean, out: Out): Screen["progress"] {
  return (label, total, unit = "bytes") => {
    let last = 0;
    let drawn = false;
    const draw = (done: number): void => {
      const now = Date.now();
      if (!live || (now - last < 80 && done < total)) return;
      last = now;
      const share = total > 0 ? Math.min(1, done / total) : 0;
      const amount =
        unit === "bytes"
          ? `${megabytes(done)} of ${megabytes(total)}`
          : `${String(done)} of ${String(total)}`;
      const tail = `${amount}  ${String(Math.round(share * 100)).padStart(3)}%`;
      const width = Math.max(0, Math.min(30, columnsOf(io) - label.length - tail.length - 10));
      const filled = Math.round(share * width);
      const [full, empty] = style.unicode ? ["━", "━"] : ["=", "-"];
      const bar =
        width === 0
          ? ""
          : `${style.accent(full.repeat(filled))}${style.dim(empty.repeat(width - filled))} `;
      io.stdout.write(`\r\u001b[K  ${style.mark("arrow")} ${label}  ${bar}${style.dim(tail)}`);
      drawn = true;
    };
    draw(0);
    return {
      update: draw,
      end: async (tone, text, detail) => {
        if (drawn) io.stdout.write("\r\u001b[K");
        await out(stepLine(style, tone, text, detail));
      },
    };
  };
}

export function openScreen(io: Io, command: string, options: ScreenOptions = {}): Screen {
  const json = options.json === true;
  const style = styleOf(io, json);
  const interactive = io.isTTY && io.outputIsTTY === true && options.yes !== true && !json;
  const abort = new AbortController();
  const removeSignal = interactive
    ? io.onSignal("SIGINT", () => {
        removeSignal();
        abort.abort();
      })
    : () => undefined;
  const lines = lineQueue(io, abort.signal, command);
  // Under --json stdout carries the one JSON document; what a person would read goes to stderr.
  const out: Out = (text) => write(json ? io.stderr : io.stdout, text);
  return {
    ...style,
    ...questions(out, style, lines, interactive),
    chooseMany: toggles(out, style, lines, interactive),
    interactive,
    columns: columnsOf(io),
    signal: abort.signal,
    line: (text = "") => out(`${text}\n`),
    heading: (text) => out(`${style.strong(text)}\n`),
    step: (tone, text, detail) => out(stepLine(style, tone, text, detail)),
    ...blocks(out, style),
    progress: progressOf(io, style, !json && io.outputIsTTY === true, out),
    close: () => {
      removeSignal();
      lines.close();
    },
  };
}

/** The screen's text blocks: aligned rows, a command to copy, a callout. */
function blocks(out: Out, style: Style): Pick<Screen, "rows" | "command" | "callout"> {
  return {
    rows: async (rows, indent = 2) => {
      const width = Math.max(0, ...rows.map(([key]) => key.length));
      const pad = " ".repeat(indent);
      await out(
        rows
          .map(([key, value]) =>
            value === ""
              ? `${pad}${style.dim(key)}\n`
              : `${pad}${style.dim(key.padEnd(width))}  ${value}\n`,
          )
          .join(""),
      );
    },
    command: (text, note) =>
      out(`    ${style.accent(text)}${note === undefined ? "" : `  ${style.dim(note)}`}\n`),
    callout: async (tone, title, more = []) => {
      await out(`${style.mark(tone)} ${style.strong(title)}\n`);
      if (more.length > 0) await out(more.map((text) => `  ${text}\n`).join(""));
    },
  };
}

/** Runs `work` with a screen, closed afterwards (its stdin reader and its Ctrl-C handler). */
export async function withScreen<T>(
  io: Io,
  command: string,
  options: ScreenOptions,
  work: (screen: Screen) => Promise<T>,
): Promise<T> {
  const screen = openScreen(io, command, options);
  try {
    return await work(screen);
  } finally {
    screen.close();
  }
}
