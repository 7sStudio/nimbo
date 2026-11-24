// A feedback entry (07-file-format §7, `.jsnb/feedback/`): what the page sends and the store checks, the entry the store
// keeps, its line in `feedback.jsonl` and its block in `FEEDBACK.md`.
import { randomBytes } from "node:crypto";

import { z } from "zod";

const shotSchema = z.string().regex(/^[A-Za-z0-9+/]+=*$/u, "base64 PNG");

/** The two screenshots as base64 PNG; either may be missing. */
export const shotsInput = z.object({
  element: shotSchema.optional(),
  viewport: shotSchema.optional(),
});

const rect = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

/** What the page sends: the note, where it points, and the two screenshots as base64 PNG. */
export const feedbackInput = z.object({
  text: z.string().trim().min(1).max(20_000),
  selector: z.string().max(4000),
  components: z.array(z.string().max(200)).max(100),
  element: z.object({
    tag: z.string().max(100),
    text: z.string().max(2000),
    html: z.string().max(20_000),
    rect,
    /** A few computed styles (font, colour, box), what a design fix starts from. */
    styles: z.record(z.string().max(100), z.string().max(500)).default({}),
  }),
  /** Set when the user dragged a box rather than clicking one element: the box, in viewport pixels. */
  area: rect.optional(),
  page: z.object({
    kind: z.enum(["home", "notebook", "output"]),
    path: z.string().max(2000),
    notebook: z.string().max(2000),
    /** The cell the element is in, on a notebook page. */
    cell: z
      .object({ id: z.string().max(100), index: z.number().int(), type: z.string().max(50) })
      .optional(),
    title: z.string().max(500),
    viewport: z.object({ width: z.number(), height: z.number(), dpr: z.number() }),
    theme: z.string().max(50),
  }),
  app: z.object({ version: z.string().max(100), commit: z.string().max(100) }),
  shots: shotsInput,
});

export type FeedbackInput = z.infer<typeof feedbackInput>;

type FeedbackStatus = "open" | "done";

export type FeedbackEntry = Omit<FeedbackInput, "shots" | "app"> & {
  readonly id: string;
  readonly at: string;
  readonly status: FeedbackStatus;
  readonly app: FeedbackInput["app"] & { readonly server: string };
  /** The screenshots' file names in the feedback folder. */
  readonly shots: { readonly element?: string; readonly viewport?: string };
};

/** A change of an entry: its status, its text, or both. */
export const changeInput = z
  .object({
    status: z.enum(["open", "done"]).optional(),
    text: z.string().trim().min(1).max(20_000).optional(),
  })
  .refine((change) => change.status !== undefined || change.text !== undefined, "status or text");

/** `20261115T131500Z-a1b2c3`: sorts by time, unique within the second. */
export const newId = (now: Date): string =>
  `${now.toISOString().replace(/[-:]/gu, "").replace(/\.\d+/u, "")}-${randomBytes(3).toString("hex")}`;

/** A screenshot name the folder may hold: an entry id and which shot, nothing that leaves the folder. */
export const isShotName = (name: string): boolean =>
  /^\d{8}T\d{6}Z-[0-9a-f]{6}-(element|viewport)\.png$/u.test(name);

const isEntry = (value: unknown): value is FeedbackEntry =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "id") === "string" &&
  typeof Reflect.get(value, "text") === "string";

/** The entries of `text`, oldest first; a line that is not an entry (a hand edit gone wrong) is skipped. */
export function parse(text: string): FeedbackEntry[] {
  const entries: FeedbackEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isEntry(value)) entries.push(value);
    } catch {
      // a broken line is left out of the list; the next write drops it
    }
  }
  return entries;
}

export const serialize = (entries: readonly FeedbackEntry[]): string =>
  entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");

/** Where an entry points, in words: `Home > HomeList > HomeRow`, the cell, the page. */
export const whereOf = (entry: FeedbackEntry): string => {
  const cell =
    entry.page.cell === undefined
      ? ""
      : ` · cell ${String(entry.page.cell.index + 1)}${entry.page.cell.type === "" ? "" : ` (${entry.page.cell.type})`}`;
  const page = entry.page.kind === "home" ? "Home" : entry.page.notebook;
  return `${page}${cell} · ${entry.components.slice(-4).join(" > ") || entry.element.tag}`;
};

/** `FEEDBACK.md`: the open entries first, then the done ones, each with its selector and screenshots, for a reader
 * who wants the list at a glance (the JSONL keeps everything). */
export function markdownOf(entries: readonly FeedbackEntry[]): string {
  const block = (entry: FeedbackEntry) => {
    const shots = Object.values(entry.shots)
      .map((name) => `[${name}](${name})`)
      .join(", ");
    return [
      `### ${entry.status === "done" ? "[x]" : "[ ]"} ${entry.id}`,
      "",
      entry.text,
      "",
      `- Where: ${whereOf(entry)}`,
      `- Selector: \`${entry.selector}\``,
      ...(shots === "" ? [] : [`- Shots: ${shots}`]),
      `- Build: ${entry.app.version} ${entry.app.commit}, ${entry.at}`,
      "",
    ].join("\n");
  };
  const open = entries.filter((entry) => entry.status === "open");
  const done = entries.filter((entry) => entry.status === "done");
  return [
    `# UI feedback (${String(open.length)} open, ${String(done.length)} done)`,
    "",
    "Each entry's full record (outerHTML, component path, computed styles, page) is in feedback.jsonl.",
    "",
    ...(open.length === 0 ? [] : ["## Open", "", ...open.map(block)]),
    ...(done.length === 0 ? [] : ["## Done", "", ...done.map(block)]),
  ].join("\n");
}
