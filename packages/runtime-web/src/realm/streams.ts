// A run's stdout and stderr: chunks coalesced per 16 ms, a cap per execution, `[output truncated]`.

export type StreamName = "stdout" | "stderr";

export type StreamOutput = {
  readonly kind: "stream";
  readonly stream: StreamName;
  readonly text: string;
};

export type Streams = {
  readonly write: (stream: StreamName, text: string) => void;
  /** Sends the pending text now: on a stream switch, at the end of a run, before the run goes stale. */
  readonly flush: () => void;
};

/** The line that replaces everything past the cap. */
const truncatedLine = "[output truncated]\n";

const coalesceMs = 16;

// The real timers, captured when the module loads: a cell's wrapped setTimeout never drives the flush.
const startTimer = globalThis.setTimeout.bind(globalThis);
const stopTimer = globalThis.clearTimeout.bind(globalThis);

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;

/** The longest prefix of `text`, cut between code points, whose UTF-8 bytes fit `budget`. */
function fitBytes(text: string, budget: number): string {
  let used = 0;
  let end = 0;
  for (const char of text) {
    used += byteLength(char);
    if (used > budget) break;
    end += char.length;
  }
  return text.slice(0, end);
}

/** `maxBytes` is `outputs.maxStreamBytes`, counted in UTF-8 bytes over the whole execution. */
export function createStreams(maxBytes: number, emit: (output: StreamOutput) => void): Streams {
  let pending: { stream: StreamName; text: string } | undefined;
  let used = 0;
  let truncated = false;
  let timer: ReturnType<typeof startTimer> | undefined;
  const flush = (): void => {
    stopTimer(timer);
    timer = undefined;
    if (pending !== undefined && pending.text !== "") emit({ kind: "stream", ...pending });
    pending = undefined;
  };
  const append = (stream: StreamName, text: string): void => {
    if (pending !== undefined && pending.stream !== stream) flush();
    pending = { stream, text: (pending?.text ?? "") + text };
  };
  const write = (stream: StreamName, text: string): void => {
    if (truncated) return;
    const size = byteLength(text);
    if (used + size <= maxBytes) {
      used += size;
      append(stream, text);
      timer ??= startTimer(flush, coalesceMs);
      return;
    }
    append(stream, fitBytes(text, maxBytes - used));
    flush();
    emit({ kind: "stream", stream, text: truncatedLine });
    truncated = true;
  };
  return { write, flush };
}
