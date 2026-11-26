// The workspace .env as the kernel holds it: read at start and before every run into the
// env built-in, process.env and the redaction set; a key that leaves the file gets its earlier value back. Only a
// regular file of at most 1 MiB is read, opened without blocking: anything else (a FIFO that would block the kernel
// for good, a directory) is EnvUnreadable at once, which ends a start before `ready` and a run before its cell.
import { join } from "node:path";

import { maxEnvBytes, parseDotenv, secretValues } from "./builtins/dotenv.js";
import { EnvUnreadable } from "./builtins/errors.js";
import { createEnv } from "./builtins/env.js";
import { readRegularFileSync } from "./ipc/regularFile.js";
import { createRedactor } from "./outputs/redact.js";

export type ProcessEnv = Record<string, string | undefined>;

export type Environment = {
  /** The `env` built-in. */
  readonly env: Readonly<Record<string, unknown>>;
  /** Reads `.env` again (a missing file is empty). */
  readonly reload: () => void;
  /** Redacts with the secrets of the latest read: every non-public value. */
  readonly redact: (text: string) => string;
};

function readValues(path: string): Readonly<Record<string, string>> {
  const read = readRegularFileSync(path, maxEnvBytes);
  if (read.kind === "missing") return {};
  if (read.kind === "refused") throw new EnvUnreadable({ path, reason: read.reason });
  return parseDotenv(read.text);
}

function restore(processEnv: ProcessEnv, key: string, before: string | undefined): void {
  if (before === undefined) Reflect.deleteProperty(processEnv, key);
  else processEnv[key] = before;
}

/** The environment of `workspace`, read once now. */
export function createEnvironment(workspace: string, processEnv: ProcessEnv): Environment {
  const builtin = createEnv();
  const path = join(workspace, ".env");
  /** The value each key had in process.env before .env set it. */
  const before = new Map<string, string | undefined>();
  let redactor = createRedactor([]);
  const reload = (): void => {
    const values = readValues(path);
    for (const [key, previous] of before) {
      if (Object.hasOwn(values, key)) continue;
      restore(processEnv, key, previous);
      before.delete(key);
    }
    for (const [key, value] of Object.entries(values)) {
      if (!before.has(key)) before.set(key, processEnv[key]);
      processEnv[key] = value;
    }
    builtin.replace(values);
    redactor = createRedactor(secretValues(values));
  };
  reload();
  return { env: builtin.env, reload, redact: (text) => redactor(text) };
}
