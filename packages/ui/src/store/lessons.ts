// The tutorial as Home and a lesson's page show it, from examples.list: where the learner goes on (the lesson the Start
// or Continue action opens), how far they went in all, a lesson's place, and the durations in words. Pure: the lessons
// come from the stores.
import type { ShippedExample } from "./homeExamples.js";

export type LessonState = "new" | "started" | "done";

export const stateOf = (lesson: ShippedExample): LessonState => lesson.progress?.state ?? "new";

/**
 * The lesson Start or Continue opens: the one last opened or run in when it is not done; after a done one, the first
 * lesson after it not done yet, else the first not done before it; the first lesson while none was opened; undefined
 * once every lesson is done.
 */
export function nextLesson(lessons: readonly ShippedExample[]): ShippedExample | undefined {
  const open = lessons.filter((each) => stateOf(each) !== "done");
  if (open.length === 0) return undefined;
  let last: ShippedExample | undefined;
  for (const each of lessons) {
    const at = each.progress?.lastActive ?? null;
    if (at !== null && (last?.progress?.lastActive ?? "") < at) last = each;
  }
  if (last === undefined || stateOf(last) !== "done") return last ?? open[0];
  const after = lessons.slice(lessons.indexOf(last) + 1).find((each) => stateOf(each) !== "done");
  return after ?? open[0];
}

/** How far the tutorial went: lessons done, of how many, and whether any lesson was opened. */
export function tutorialProgress(lessons: readonly ShippedExample[]) {
  const done = lessons.filter((each) => stateOf(each) === "done").length;
  return {
    done,
    of: lessons.length,
    begun: lessons.some((each) => stateOf(each) !== "new"),
    finished: lessons.length > 0 && done === lessons.length,
  };
}

/** "8 min", "1 h", "1 h 21 min". */
export function minutesText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** The time every lesson that states one takes, in words; empty when none states it. */
export function totalText(lessons: readonly ShippedExample[]): string {
  const total = lessons.reduce((sum, each) => sum + (each.minutes ?? 0), 0);
  return total === 0 ? "" : minutesText(total);
}

/** The lesson `path` is the workspace's copy of (`tutorial/<lesson>.jsnb`), with its place in the tutorial. */
export function lessonAt(
  lessons: readonly ShippedExample[],
  path: string,
): { readonly lesson: ShippedExample; readonly number: number } | undefined {
  const at = lessons.findIndex((each) => `${each.name}.jsnb` === path);
  const lesson = lessons[at];
  return lesson === undefined ? undefined : { lesson, number: at + 1 };
}

/** The first action of Home's welcome and the Tutorial page, which Enter runs from an empty Home's search field: the
 * tutorial started or gone on with while it shows and is not done, else a new notebook. */
export function primaryAction(
  lessons: readonly ShippedExample[],
  shown: boolean,
): { readonly label: string; readonly command: string } {
  const next = nextLesson(lessons);
  if (!shown || next === undefined) return { label: "New Notebook", command: "ui.notebook.new" };
  if (!tutorialProgress(lessons).begun)
    return { label: "Start Tutorial", command: "ui.home.tutorial" };
  return {
    label: `Continue: Lesson ${String(lessons.indexOf(next) + 1)}`,
    command: "ui.home.tutorial",
  };
}
