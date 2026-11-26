// A clock and a scheduler the test moves by hand, for code that takes its time as a dependency (the tooltips): no
// global clock is faked, and no test sleeps.
import type { Scheduler } from "../tooltip.js";

export function manualTime() {
  let time = 0;
  let jobs: { readonly at: number; readonly run: () => void; readonly ms: number }[] = [];
  const schedule: Scheduler = (run, ms) => {
    const job = { at: time + ms, run, ms };
    jobs.push(job);
    return () => {
      jobs = jobs.filter((other) => other !== job);
    };
  };
  return {
    now: () => time,
    schedule,
    /** Moves the clock and runs what came due. */
    advance: (ms: number): void => {
      time += ms;
      const due = jobs.filter((job) => job.at <= time);
      jobs = jobs.filter((job) => job.at > time);
      for (const job of due) job.run();
    },
    /** The delays of the work still waiting. */
    delays: (): number[] => jobs.map((job) => job.ms),
  };
}
