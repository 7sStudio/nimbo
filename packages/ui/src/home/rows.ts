// The words of a Home row and of its preview: the kernel's state, always in words and never by a dot,
// its color only repeating the word (idle green, exited red); the modified time as a person says it ("3 min ago", the
// ISO time in a tooltip) and the size.
import { elapsedText } from "../app/models.js";
import type { HomeKernel } from "../store/homeReduce.js";

/** One line of the Home list, as HomeRow shows it. */
export type RowModel = {
  readonly path: string;
  /** The folder the notebook is in, "" at the workspace's root. */
  readonly folder: string;
  /** The name without .jsnb: before, marked and after the typed word. */
  readonly parts: readonly [string, string, string];
  readonly kernel: string;
  /** The classes that repeat the kernel's word in color. */
  readonly tone: string;
  readonly cells: string;
  readonly routes: string;
  readonly edited: string;
  /** The modified time and the size, for the tooltip. */
  readonly file: string;
  readonly open: boolean;
};

/** A notebook's kernel in words while it is open (nothing for a closed one): its state, a running one with how long
 * its run has gone on. */
export function kernelWords(open: boolean, kernel: HomeKernel | undefined, now: number): string {
  if (!open) return "";
  if (kernel === undefined) return "open";
  if (kernel.state === "busy") {
    const since = kernel.busySince === null ? null : Date.parse(kernel.busySince);
    return since === null ? "running" : `running, ${elapsedText(now - since)}`;
  }
  const words = {
    starting: "starting",
    idle: "idle",
    paused: "paused in debugger",
    dead: "exited",
  };
  return words[kernel.state];
}

/** The tone that repeats the kernel's word: idle green, exited red, running ink, the rest quiet. */
export function kernelTone(open: boolean, kernel: HomeKernel | undefined): string {
  if (!open || kernel === undefined) return "ui:text-muted";
  if (kernel.state === "idle") return "ui:text-ok";
  if (kernel.state === "dead") return "ui:text-err";
  return kernel.state === "busy" ? "ui:font-medium ui:text-fg" : "ui:text-fg-2";
}

// One formatter for the dates of older files, made when the module loads: "12 Oct", "12 Oct 2025".
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/** `iso` as a person says it from `now`: just now, 3 min ago, 2 h ago, yesterday, 4 days ago, then the date (its year
 * when it is not this year's). */
export function relativeTime(iso: string | null, now: number): string {
  if (iso === null) return "";
  const at = Date.parse(iso);
  const ago = Math.max(0, now - at);
  if (ago < minute) return "just now";
  if (ago < hour) return `${String(Math.floor(ago / minute))} min ago`;
  if (ago < day) return `${String(Math.floor(ago / hour))} h ago`;
  if (ago < 2 * day) return "yesterday";
  if (ago < 7 * day) return `${String(Math.floor(ago / day))} days ago`;
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return (sameYear ? dayMonth : dayMonthYear).format(at);
}

/** A file size in bytes as the list shows it: 812 B, 4.2 KB, 1.3 MB. */
export function sizeText(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
