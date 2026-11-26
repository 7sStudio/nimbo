// How far the workspace went in the tutorial, kept by the daemon in `.jsnb/tutorial.json` (out of git, as everything
// under `.jsnb/` but the shared settings): for each lesson whose copy at `tutorial/<lesson>.jsnb` was opened or run in,
// when that last happened and which of the lesson's code cells finished a run there. It is heard from the event
// stream, so the page, the CLI and an agent move it alike; a copy elsewhere, a cell the learner added and a run that
// never ended count for nothing. The file is read once, at the first need, and written after a short pause and at
// stop; one that cannot be read or is not the format starts the record over.
import { join } from "node:path";

import type { EventEnvelope, LessonProgress } from "@jsnb/core";
import { tutorialName } from "@jsnb/core";
import { z } from "zod";

import { writeAtomically } from "../atomicWrite.js";
import { readRegularFile } from "../regularFile.js";
import type { Example } from "./examples.js";

const fileName = "tutorial.json";
const maxBytes = 262_144;
const writeDelayMs = 250;

const fileSchema = z.object({
  version: z.literal(1),
  lessons: z.record(
    z.string(),
    z.object({
      lastActive: z.string(),
      ran: z.array(z.string()).max(1000),
    }),
  ),
});

type Lesson = { lastActive: string; ran: Set<string> };

/** The lesson `ref` is the copy of: `tutorial/<lesson>.jsnb` for a shipped lesson; undefined for any other path. */
const lessonOf = (ref: string, known: ReadonlyMap<string, Example>): Example | undefined => {
  const name = ref.endsWith(".jsnb") ? ref.slice(0, -".jsnb".length) : "";
  return name.startsWith(`${tutorialName}/`) ? known.get(name) : undefined;
};

const ended = new Set(["ok", "error", "interrupted"]);

export type TutorialProgress = {
  /** How far the workspace went in `lesson`, a shipped lesson. */
  readonly of: (lesson: Example) => Promise<LessonProgress>;
  /** Writes what is not written yet and stops listening. */
  readonly close: () => Promise<void>;
};

type Options = {
  /** The workspace's `.jsnb/` folder. */
  readonly dir: string;
  /** Hears every event of the daemon; answers the stop (the event bus's listen). */
  readonly listen: (listener: (event: EventEnvelope) => void) => () => void;
  /** The shipped lessons. */
  readonly lessons: () => Promise<readonly Example[]>;
  readonly warn: (message: string, error?: unknown) => void;
};

export function trackTutorial({ dir, listen, lessons, warn }: Options): TutorialProgress {
  const file = join(dir, fileName);
  const record = new Map<string, Lesson>();
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing = Promise.resolve();

  const load = async (): Promise<ReadonlyMap<string, Example>> => {
    const known = new Map((await lessons()).map((each) => [each.name, each]));
    const read = await readRegularFile(file, maxBytes, { follow: false });
    if (read.kind === "refused") warn(`${file} is not read: ${read.reason}`);
    if (read.kind !== "read") return known;
    let parsed: z.infer<typeof fileSchema> | undefined;
    try {
      const json: unknown = JSON.parse(read.text);
      parsed = fileSchema.parse(json);
    } catch (error) {
      warn(`${file} is not the tutorial's progress and starts over`, error);
    }
    for (const [name, lesson] of Object.entries(parsed?.lessons ?? {})) {
      if (known.has(name))
        record.set(name, { lastActive: lesson.lastActive, ran: new Set(lesson.ran) });
    }
    return known;
  };
  let loaded: Promise<ReadonlyMap<string, Example>> | undefined;
  const ready = () => (loaded ??= load());

  const text = (): string => {
    const entries = [...record].map(
      ([name, lesson]) => [name, { lastActive: lesson.lastActive, ran: [...lesson.ran] }] as const,
    );
    return `${JSON.stringify({ version: 1, lessons: Object.fromEntries(entries) }, null, 2)}\n`;
  };
  const write = (): Promise<void> => {
    timer = undefined;
    if (!dirty) return writing;
    dirty = false;
    const content = text();
    writing = writing
      .then(() => writeAtomically(file, content, { mode: 0o600 }))
      .then(
        () => undefined,
        (error: unknown) => {
          warn(`the tutorial's progress could not be written to ${file}`, error);
        },
      );
    return writing;
  };
  const changed = () => {
    dirty = true;
    timer ??= setTimeout(() => void write(), writeDelayMs);
    timer.unref();
  };

  const touch = (lesson: Example, at: string): Lesson => {
    const known = record.get(lesson.name) ?? { lastActive: at, ran: new Set<string>() };
    known.lastActive = at > known.lastActive ? at : known.lastActive;
    record.set(lesson.name, known);
    return known;
  };
  const heard = async (event: EventEnvelope): Promise<void> => {
    if (event.type !== "notebook.opened" && event.type !== "cell.status") return;
    if (event.type === "cell.status" && !ended.has(event.data.status)) return;
    const lesson = lessonOf(event.notebook, await ready());
    if (lesson === undefined) return;
    const known = touch(lesson, event.ts);
    if (event.type === "cell.status" && lesson.code.includes(event.data.cell))
      known.ran.add(event.data.cell);
    changed();
  };
  const stop = listen((event) => {
    void heard(event).catch((error: unknown) => {
      warn("the tutorial's progress missed an event", error);
    });
  });

  return {
    of: async (lesson) => {
      await ready();
      const known = record.get(lesson.name);
      const ran = lesson.code.filter((cell) => known?.ran.has(cell) === true).length;
      const of = lesson.code.length;
      const state = known === undefined ? "new" : of > 0 && ran === of ? "done" : "started";
      return { state, ran, of, lastActive: known?.lastActive ?? null };
    },
    close: async () => {
      stop();
      if (timer !== undefined) clearTimeout(timer);
      await write();
    },
  };
}
