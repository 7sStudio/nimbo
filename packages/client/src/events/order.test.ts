// Tests the ordering steps of 02-architecture §4.2: buffer, start at the seq, deliver in order, drop, gap.
import { describe, expect, it } from "vitest";

import type { Ordering, Sequenced, Step } from "./order.js";
import { buffering, receive, start } from "./order.js";

const at = (seq: number): Sequenced => ({ seq });
const seqs = (step: Step<Sequenced>): number[] => step.deliver.map((event) => event.seq);

describe("receive", () => {
  it("buffers while the state is fetched", () => {
    const step = receive(buffering(), at(4));
    expect(step).toEqual({
      ordering: { phase: "buffering", buffer: [at(4)] },
      deliver: [],
      gap: false,
    });
  });

  it("delivers the next seq when live", () => {
    const live: Ordering<Sequenced> = { phase: "live", last: 4 };
    expect(receive(live, at(5))).toEqual({
      ordering: { phase: "live", last: 5 },
      deliver: [at(5)],
      gap: false,
    });
  });

  it("drops a seq at or below the last one", () => {
    const live: Ordering<Sequenced> = { phase: "live", last: 4 };
    expect(receive(live, at(4))).toEqual({ ordering: live, deliver: [], gap: false });
    expect(receive(live, at(2)).deliver).toEqual([]);
  });

  it("reports a gap, back to buffering, when a seq is skipped", () => {
    const step = receive({ phase: "live", last: 4 }, at(6));
    expect(step).toEqual({ ordering: buffering(), deliver: [], gap: true });
  });
});

describe("start", () => {
  it("delivers the buffered events above the seq, sorted, without duplicates", () => {
    let ordering = buffering<Sequenced>();
    for (const seq of [5, 3, 4, 5, 2]) ordering = receive(ordering, at(seq)).ordering;
    const step = start(ordering, 3);
    expect(seqs(step)).toEqual([4, 5]);
    expect(step.ordering).toEqual({ phase: "live", last: 5 });
    expect(step.gap).toBe(false);
  });

  it("delivers up to a hole in the buffer, then reports the gap", () => {
    let ordering = buffering<Sequenced>();
    for (const seq of [4, 6]) ordering = receive(ordering, at(seq)).ordering;
    const step = start(ordering, 3);
    expect(seqs(step)).toEqual([4]);
    expect(step.gap).toBe(true);
    expect(step.ordering).toEqual(buffering());
  });

  it("goes live at the seq with nothing buffered", () => {
    expect(start(buffering(), 9)).toEqual({
      ordering: { phase: "live", last: 9 },
      deliver: [],
      gap: false,
    });
    expect(start({ phase: "live", last: 2 }, 9).ordering).toEqual({ phase: "live", last: 9 });
  });
});
