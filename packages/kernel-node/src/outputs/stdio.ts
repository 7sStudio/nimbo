// The child's process.stdout and process.stderr, routed (04-kernel §5.1): text written under a store goes to the
// sink, text written with none (startup noise) to the original stream, which is the daemon's kernel log.
import type { StreamName } from "./sink.js";

/** The slice of a stream the patch needs; `process.stdout` and a test's fake both fit. */
export type PatchableStream = {
  write(chunk: string | Uint8Array, ...rest: unknown[]): boolean;
};

/** Takes `text` written to `stream` when a store is current; false hands it to the original stream. */
export type StdioTake = (stream: StreamName, text: string) => boolean;

export type PatchedStdio = {
  /** Writes to the original stream, bypassing the patch (the kernel's own log lines). */
  readonly log: (stream: StreamName, text: string) => void;
  readonly restore: () => void;
};

type Patched = { readonly log: (text: string) => void; readonly restore: () => void };

const decoder = new TextDecoder();

const asText = (chunk: string | Uint8Array): string =>
  typeof chunk === "string" ? chunk : decoder.decode(chunk);

/** Starts user code later: the kernel's promise job (04-kernel §6), never queueMicrotask. */
export type StartLater = (job: () => void) => void;

/**
 * Calls the write callback, when one was passed, once the write is taken (Node calls it asynchronously too). The
 * callback is user code, so it starts as the kernel starts user code, `later`; a throw is a late error.
 */
function acknowledge(rest: readonly unknown[], later: StartLater): void {
  const callback = rest.at(-1);
  if (typeof callback !== "function") return;
  later(() => {
    Reflect.apply(callback, undefined, []);
  });
}

function patch(
  stream: PatchableStream,
  name: StreamName,
  take: StdioTake,
  later: StartLater,
): Patched {
  const own = Object.getOwnPropertyDescriptor(stream, "write");
  const original = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {
    if (!take(name, asText(chunk))) return original(chunk, ...rest);
    acknowledge(rest, later);
    return true;
  };
  return {
    log: (text) => {
      original(text);
    },
    restore: () => {
      if (own) Object.defineProperty(stream, "write", own);
      else Reflect.deleteProperty(stream, "write");
    },
  };
}

/** Replaces both streams' `write` with one that offers the text to `take` first; `later` starts write callbacks. */
export function patchStdio(
  streams: { readonly stdout: PatchableStream; readonly stderr: PatchableStream },
  take: StdioTake,
  later: StartLater,
): PatchedStdio {
  const patched = {
    stdout: patch(streams.stdout, "stdout", take, later),
    stderr: patch(streams.stderr, "stderr", take, later),
  };
  return {
    log: (name, text) => {
      patched[name].log(text);
    },
    restore: () => {
      patched.stdout.restore();
      patched.stderr.restore();
    },
  };
}
