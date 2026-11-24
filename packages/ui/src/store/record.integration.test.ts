// @vitest-environment node
// The reducer against live daemons: each flow of fixtures/flows.ts runs on a real daemon and kernel, and the mirror its
// events reduce to must equal the daemon's own notebook.get. With NIMBO_RECORD=1 the logs are written as the fixtures
// reduce.test.ts replays (`pnpm --filter @jsnb/ui record:events`).
import { writeFile } from "node:fs/promises";

import type { EventEnvelope, NotebookState } from "@jsnb/core";
import { eventsSubscribe, eventTypes } from "@jsnb/core";
import type { Daemon } from "@jsnb/test-daemon";
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";

import { flows, notebook } from "./fixtures/flows.js";
import { projection, replay } from "./fixtures/replay.js";

const record = process.env.NIMBO_RECORD === "1";

/** The notebook's state and the seq it stands at, once two reads in a row agree on the seq. */
async function settled(daemon: Daemon): Promise<{ state: NotebookState; seq: number }> {
  for (;;) {
    const { seq } = await daemon.client.call(eventsSubscribe, { notebook });
    const { notebook: state } = await daemon.client.notebook.get({ notebook });
    const again = await daemon.client.call(eventsSubscribe, { notebook });
    if (again.seq === seq) return { state, seq };
  }
}

const ofNotebook = (events: readonly EventEnvelope[], from: number, to: number) =>
  events.filter((event) => event.notebook === notebook && event.seq > from && event.seq <= to);

/** Resolves once the recorder holds the notebook's event `seq` (an event of any type). */
const reached = (daemon: Daemon, seq: number): Promise<unknown> =>
  seq === 0
    ? Promise.resolve()
    : Promise.any(
        eventTypes.map((type) =>
          daemon.events.until(type, (event) => event.notebook === notebook && event.seq >= seq),
        ),
      );

describe.each(Object.entries(flows))("the %s flow", (name, flow) => {
  it("reduces to the daemon's own state", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.notebook.create({ path: notebook });
      const start = await settled(daemon);
      await flow(daemon, ws);
      const end = await settled(daemon);
      await reached(daemon, end.seq);
      const events = ofNotebook(daemon.events.all(), start.seq, end.seq);
      const mirror = replay(start.state, start.seq, events);
      expect(mirror.seq).toBe(end.seq);
      expect(mirror.notebook && projection(mirror.notebook)).toEqual(projection(end.state));
      if (!record) return;
      const lines = events.map((event) => `${JSON.stringify(event)}\n`).join("");
      await writeFile(new URL(`./fixtures/${name}.jsonl`, import.meta.url), lines);
      const recording = { start: start.state, startSeq: start.seq, end: end.state };
      await writeFile(
        new URL(`./fixtures/${name}.state.json`, import.meta.url),
        `${JSON.stringify(recording, null, 2)}\n`,
      );
    });
  });
});
