// One node-api DuckDB instance for the daemon: open, the connections it hands out, and close, which interrupts
// them and rejects the work in flight. A native crash takes the daemon down, so there is no crash watch here.
// node-api crashes the process (SIGSEGV) or hangs when a connection is closed while DuckDB still runs a call on it, so
// close frees the connections and the instance only once every call it interrupted has returned.
import { lstat, mkdir, unlink } from "node:fs/promises";
import { join, sep } from "node:path";

import type { DuckDBConnection } from "@duckdb/node-api";
import { DuckDBInstance } from "@duckdb/node-api";

import type { QueryError } from "../errors.ts";
import { quoteLiteral } from "../sql.ts";

/**
 * DuckDB clears a connection's interrupt when it begins a statement, so an interrupt that lands between the stream
 * call and that start is lost and the statement would run to its end: once stopped, a call is interrupted again at
 * this interval until it returns.
 */
export const interruptAgainMs = 10;

export type NodeInstance = {
  /** Runs one call into DuckDB; rejects with the close error when the instance closes first. */
  track<T>(call: () => Promise<T>): Promise<T>;
  /** A fresh connection, interrupted if the instance closes while it is open. */
  connect(): Promise<DuckDBConnection>;
  /** Closes a connection `connect` gave; after `close`, `close` frees it instead. */
  release(connection: DuckDBConnection): void;
  /** Rejects the work in flight with `error` at once; frees DuckDB once the calls it interrupted return. */
  close(error: QueryError): void;
  isAlive(): boolean;
};

type Tracker = {
  readonly track: <T>(call: () => Promise<T>) => Promise<T>;
  /** Rejects every call in flight, and every later one, with `error`. */
  close(error: QueryError): void;
  closed(): boolean;
  /** Settles once DuckDB has returned from every call it is running, the ones `close` rejected included. */
  idle(): Promise<void>;
};

function tracker(): Tracker {
  let closed: QueryError | undefined;
  const pending = new Set<(error: QueryError) => void>();
  const running = new Set<Promise<unknown>>();
  const track = <T>(call: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      if (closed !== undefined) {
        reject(closed);
        return;
      }
      pending.add(reject);
      const native = call();
      running.add(native);
      native.then(
        (value) => {
          running.delete(native);
          pending.delete(reject);
          resolve(value);
        },
        (error: unknown) => {
          running.delete(native);
          pending.delete(reject);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  const close = (error: QueryError) => {
    closed ??= error;
    for (const reject of pending) reject(error);
    pending.clear();
  };
  const idle = async () => {
    await Promise.allSettled([...running]);
  };
  return { track, close, closed: () => closed !== undefined, idle };
}

/** Where DuckDB spills, below `directory`. */
const tempFolderOf = (directory: string): string => join(directory, "__nimbo_temp");

/**
 * The spill folder made a real folder of its own before DuckDB opens, on every open: a cloned workspace may carry `__nimbo_temp` as a symbolic link, which would send DuckDB's spill
 * files, the user's query data, to its target. A link, or anything else that is not a folder, is removed itself (never
 * followed) and the folder made again, mode 0700; a folder already there is kept.
 */
async function realTempFolder(directory: string): Promise<void> {
  const path = tempFolderOf(directory);
  const stats = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") return undefined;
    throw error;
  });
  if (stats?.isDirectory() === true) return;
  if (stats !== undefined) await unlink(path); // the link itself, or a file: never what a link points to
  await mkdir(path, { mode: 0o700 }); // fails if something appeared meanwhile: nothing is followed
}

/**
 * The settings that keep the daemon's DuckDB inside `directory` (09 §5: the daemon writes only inside the
 * workspace): files there and nowhere else, temporary files there too (a real folder, made so before each open), no
 * extension installed or loaded, and the configuration locked so no SQL can undo it.
 */
const confinement = (directory: string) => [
  `SET allowed_directories = [${quoteLiteral(`${directory}${sep}`)}]`,
  `SET temp_directory = ${quoteLiteral(tempFolderOf(directory))}`,
  "SET autoinstall_known_extensions = false",
  "SET autoload_known_extensions = false",
  "SET enable_external_access = false",
  "SET lock_configuration = true",
];

async function confine(instance: DuckDBInstance, directory: string) {
  const connection = await instance.connect();
  try {
    for (const sql of confinement(directory)) await connection.run(sql);
  } finally {
    connection.closeSync();
  }
}

/** An in-memory DuckDB confined to `directory`, its spill folder made a real one first. */
async function confined(directory: string): Promise<DuckDBInstance> {
  await realTempFolder(directory);
  const instance = await DuckDBInstance.create(":memory:");
  try {
    await confine(instance, directory);
  } catch (error) {
    instance.closeSync();
    throw error;
  }
  return instance;
}

/** Opens an in-memory DuckDB confined to `directory` (an absolute path). */
export async function openInstance(directory: string): Promise<NodeInstance> {
  const instance = await confined(directory);
  const calls = tracker();
  const connections = new Set<DuckDBConnection>();
  return {
    track: calls.track,
    connect: async () => {
      const connection = await calls.track(() => instance.connect());
      connections.add(connection);
      return connection;
    },
    release: (connection) => {
      // once closed, close owns the connection: the call it rejected may still be running on it
      if (calls.closed()) return;
      connections.delete(connection);
      connection.closeSync();
    },
    close: (error) => {
      if (calls.closed()) return;
      calls.close(error);
      const interruptAll = () => {
        for (const connection of connections) connection.interrupt();
      };
      interruptAll();
      // An interrupt DuckDB receives before it begins a statement is lost: repeat until every call has returned.
      const again = setInterval(interruptAll, interruptAgainMs);
      void calls.idle().then(() => {
        clearInterval(again);
        for (const connection of connections) connection.closeSync();
        connections.clear();
        instance.closeSync();
      });
    },
    isAlive: () => !calls.closed(),
  };
}
