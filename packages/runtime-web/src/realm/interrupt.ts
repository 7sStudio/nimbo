// realm.interrupt (02-architecture §5, 03-api §4.4): a kernel.interrupt while this page runs a client cell ends that run
// `interrupted` as a reset or a re-run does: its pending stream text and its status reported, realm.execute answered at
// once, whatever it reports later dropped; the answer carries the names it defined, for the daemon's record, and the
// DOM of the container it used, its `dom` output, so the container stays in its cell, whichever of the page's reports
// reaches the daemon first. Its code cannot be stopped from outside; its
// definitions, container, timers and listeners stay, as an interrupted server cell's scope does, until it runs again.
import type { RealmInterrupt, RealmInterruptAnswer } from "@jsnb/core";

import { domSnapshot } from "../display/snapshot.js";
import { retire } from "./execute.js";
import { redact } from "./redact.js";
import type { RealmState } from "./state.js";

/**
 * Ends the run of `execution` if it is still in progress, answering the names it defined. A run that ended keeps
 * reporting its late outputs (an interrupt that crossed its status changes nothing), and one this realm never ran, or
 * no longer holds, is left: the answer names nothing then.
 */
export function interrupt(state: RealmState, params: RealmInterrupt): RealmInterruptAnswer {
  for (const run of state.runs.values()) {
    const live = run.flags.inProgress && !run.flags.stale;
    if (run.execution !== params.execution || !live) continue;
    retire(state, run, true);
    const container = run.flags.usedContainer ? state.containers.get(run.cell) : undefined;
    const dom = container === undefined ? undefined : domSnapshot(container);
    const defines = [...run.defines].sort();
    return dom === undefined
      ? { defines }
      : { defines, dom: { html: redact(dom.html), text: redact(dom.text) } };
  }
  return {};
}
