// Where the tutorial goes on: the lesson Start or Continue opens from what examples.list says of each lesson.
import { describe, expect, it } from "vitest";

import type { ShippedExample } from "./homeExamples.js";
import { minutesText, nextLesson, totalText, tutorialProgress } from "./lessons.js";

type State = "new" | "started" | "done";

/** Lessons 1 to n, each in the state given and, when not new, last active at the minute given. */
const lessons = (...states: readonly (readonly [State, number?])[]): ShippedExample[] =>
  states.map(([state, minute], at) => ({
    name: `tutorial/0${String(at + 1)}`,
    kind: "tutorial",
    title: `Lesson ${String(at + 1)}`,
    purpose: "A purpose.",
    cells: 4,
    minutes: 8,
    progress: {
      state,
      ran: state === "done" ? 2 : 0,
      of: 2,
      lastActive:
        minute === undefined ? null : `2026-11-26T10:${String(minute).padStart(2, "0")}:00.000Z`,
    },
  }));

const nameOf = (list: readonly ShippedExample[]) => nextLesson(list)?.name;

describe("nextLesson", () => {
  it("starts at the first lesson, and goes on with the one last opened while it is not done", () => {
    expect(nameOf(lessons(["new"], ["new"], ["new"]))).toBe("tutorial/01");
    expect(nameOf(lessons(["done", 1], ["started", 5], ["started", 3]))).toBe("tutorial/02");
    expect(nameOf(lessons(["started", 1], ["new"], ["started", 9]))).toBe("tutorial/03");
  });

  it("after a lesson just done, goes to the next one not done, then back to one skipped", () => {
    expect(nameOf(lessons(["done", 1], ["done", 2], ["new"]))).toBe("tutorial/03");
    expect(nameOf(lessons(["new"], ["done", 4], ["done", 2], ["new"]))).toBe("tutorial/04");
    expect(nameOf(lessons(["new"], ["started", 1], ["done", 7]))).toBe("tutorial/01");
  });

  it("has nowhere to go once every lesson is done", () => {
    expect(nextLesson(lessons(["done", 1], ["done", 2]))).toBeUndefined();
    expect(tutorialProgress(lessons(["done", 1], ["done", 2]))).toEqual({
      done: 2,
      of: 2,
      begun: true,
      finished: true,
    });
    expect(tutorialProgress([])).toEqual({ done: 0, of: 0, begun: false, finished: false });
  });
});

describe("minutesText and totalText", () => {
  it("say minutes and hours as a person reads them", () => {
    expect(minutesText(8)).toBe("8 min");
    expect(minutesText(60)).toBe("1 h");
    expect(minutesText(81)).toBe("1 h 21 min");
    expect(totalText(lessons(["new"], ["new"]))).toBe("16 min");
    expect(totalText([])).toBe("");
  });
});
