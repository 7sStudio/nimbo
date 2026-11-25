// The output sink of 04-kernel §5: every output leaves as an `output` message on its store's execution. Stream text
// is coalesced per execution and flushed after 16 ms, before any other output of that execution and before its
// terminal status; at flush it is redacted, its cell positions are rewritten (a printed stack shows the cells' own
// lines), then it is capped at maxStreamBytes with a final "[output truncated]". An interrupt can stop user code
// inside a write (console.log), so the flush timer is scheduled before the execution is marked pending: a mark never
// stands without the timer that clears it (04-kernel §6).
import { Buffer } from "node:buffer";

import type { CellId, ExecutionId, FullValue, Output } from "@jsnb/core";

import type { Redact } from "./redact.js";

type SinkStore = { readonly cell: CellId; readonly execution: ExecutionId };
export type StreamName = "stdout" | "stderr";

export type SinkOptions = {
  readonly send: (execution: ExecutionId, output: Output, full?: FullValue) => void;
  /** The current redactor; stream text is the one output the sink redacts itself (each producer redacts its own). */
  readonly redact: Redact;
  /** Rewrites the cell positions of a stack printed in stream text to the cells' own lines (04-kernel §5.3). */
  readonly rewrite: (text: string) => string;
  readonly maxStreamBytes: number;
  /** Runs `flush` later (production: a 16 ms timer, 04-kernel §5.1). */
  readonly schedule: (flush: () => void) => void;
};

export type Sink = {
  /** Stream text written under `store`. */
  readonly write: (store: SinkStore, stream: StreamName, text: string) => void;
  /** Any other output, already redacted by its producer; the execution's pending streams go first. */
  readonly emit: (store: SinkStore, output: Output, full?: FullValue) => void;
  /** Sends the execution's pending stream text now (before its terminal status). */
  readonly flush: (execution: ExecutionId) => void;
  readonly flushAll: () => void;
  /** A new run of `store.cell`: the state of its previous execution is flushed and dropped. */
  readonly begin: (store: SinkStore) => void;
};

type Segment = { readonly stream: StreamName; text: string };
type State = {
  readonly cell: CellId;
  readonly segments: Segment[];
  bytes: number;
  truncated: boolean;
  /** A flush timer is scheduled for this execution's segments. */
  pending: boolean;
};

const truncatedNotice = "[output truncated]";

/** The UTF-8 size of one code point (a lone surrogate encodes as U+FFFD, three bytes). */
const utf8Size = (point: number): number =>
  point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;

/** The longest prefix of `text`, cut between code points, whose UTF-8 form fits `budget` bytes. */
function fitBytes(text: string, budget: number): string {
  let used = 0;
  let index = 0;
  while (index < text.length) {
    const point = text.codePointAt(index) ?? 0;
    const size = utf8Size(point);
    if (used + size > budget) break;
    used += size;
    index += point > 0xffff ? 2 : 1;
  }
  return text.slice(0, index);
}

/** A sink over `options.send`. */
export function createSink(options: SinkOptions): Sink {
  const states = new Map<ExecutionId, State>();
  const latest = new Map<CellId, ExecutionId>();

  const sendSegment = (execution: ExecutionId, state: State, segment: Segment): void => {
    const { send, redact, rewrite, maxStreamBytes } = options;
    const text = rewrite(redact(segment.text));
    const size = Buffer.byteLength(text, "utf8");
    if (state.bytes + size <= maxStreamBytes) {
      state.bytes += size;
      send(execution, { kind: "stream", stream: segment.stream, text });
      return;
    }
    const head = fitBytes(text, maxStreamBytes - state.bytes);
    if (head !== "") send(execution, { kind: "stream", stream: segment.stream, text: head });
    send(execution, { kind: "stream", stream: segment.stream, text: truncatedNotice });
    state.bytes = maxStreamBytes;
    state.truncated = true;
  };

  const flushState = (execution: ExecutionId, state: State): void => {
    state.pending = false;
    for (const segment of state.segments.splice(0)) {
      if (state.truncated) break;
      sendSegment(execution, state, segment);
    }
    // An execution that is no longer its cell's latest keeps no state once its late text is out.
    const current = latest.get(state.cell);
    if (current !== undefined && current !== execution) states.delete(execution);
  };

  const flush = (execution: ExecutionId): void => {
    const state = states.get(execution);
    if (state) flushState(execution, state);
  };

  const stateOf = (store: SinkStore): State => {
    const known = states.get(store.execution);
    if (known) return known;
    const fresh: State = {
      cell: store.cell,
      segments: [],
      bytes: 0,
      truncated: false,
      pending: false,
    };
    states.set(store.execution, fresh);
    return fresh;
  };

  return {
    write: (store, stream, text) => {
      const state = stateOf(store);
      if (text === "" || state.truncated) return;
      const last = state.segments.at(-1);
      if (last?.stream === stream) last.text += text;
      else state.segments.push({ stream, text });
      if (state.pending) return;
      // Scheduled, then marked: stopped in between, the timer still flushes and the next write schedules again. The
      // flush is idempotent, so a timer that finds its text already sent sends nothing.
      options.schedule(() => {
        flushState(store.execution, state);
      });
      state.pending = true;
    },
    emit: (store, output, full) => {
      flush(store.execution);
      options.send(store.execution, output, full);
    },
    flush,
    flushAll: () => {
      for (const [execution, state] of states) flushState(execution, state);
    },
    begin: (store) => {
      const previous = latest.get(store.cell);
      latest.set(store.cell, store.execution);
      if (previous !== undefined && previous !== store.execution) flush(previous);
    },
  };
}
