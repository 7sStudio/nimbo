// The daemon log: structured JSON lines (pino) to .jsnb/logs/daemon.log,
// rotated at 5 × 1 MB, and to stderr when the daemon runs in the foreground; every line passes the redaction once, at
// this boundary (the token and the workspace secrets), before it reaches any file or stream. Logging never throws:
// a line the file cannot take (a full disk, a folder that refuses writes) is dropped and counted,
// and the first line written after that is preceded by one warning that says how many were dropped and why.
import { join } from "node:path";

import type { Logger } from "pino";
import { pino } from "pino";

import { droppingWriter } from "./drops.js";
import type { RotatingFile } from "./rotatingFile.js";
import { openRotatingFile } from "./rotatingFile.js";

export type LogLevel = "error" | "warn" | "info" | "debug";

type LoggerOptions = {
  /** `.jsnb/logs`. */
  readonly folder: string;
  readonly level: LogLevel;
  /** Applied to each whole line, after pino wrote it. */
  readonly redact: (text: string) => string;
  /** Also write each line to this stream (stderr in the foreground). */
  readonly echo?: { readonly write: (text: string) => unknown };
  /** The size at which daemon.log rotates; default 1 MiB. */
  readonly maxBytes?: number;
};

export type DaemonLog = {
  readonly logger: Logger;
  /** Flushes and closes the file; later lines are dropped. */
  readonly close: () => void;
};

/** `NIMBO_LOG=debug` raises the level; anything else that names a level sets it; the default is info. */
export function levelOf(value: string | undefined): LogLevel {
  const levels: readonly LogLevel[] = ["error", "warn", "info", "debug"];
  return levels.find((level) => level === value) ?? "info";
}

/** Writes to the echo stream; a stream that refuses (a closed pipe) never stops the daemon or the file's lines. */
function echoed(echo: LoggerOptions["echo"], line: string): void {
  try {
    echo?.write(line);
  } catch {
    // A foreground stderr that throws (a closed terminal): the file keeps the line, which is the record that matters.
  }
}

/** The destination pino writes to: the redacted line to the file and the echo, drops counted and reported. */
function destinationOf(options: LoggerOptions, file: RotatingFile) {
  const toFile = droppingWriter(file, "daemon log", (note) => {
    echoed(options.echo, note);
  });
  return {
    write: (text: string): void => {
      const line = options.redact(text);
      toFile(line);
      echoed(options.echo, line);
    },
  };
}

/** Opens `daemon.log` in `folder` and returns the logger that writes it. */
export function openDaemonLog(options: LoggerOptions): DaemonLog {
  const file = openRotatingFile(join(options.folder, "daemon.log"), {
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  });
  const destination = destinationOf(options, file);
  const logger = pino(
    {
      level: options.level,
      base: { pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
  return {
    logger,
    close: () => {
      file.close();
    },
  };
}
