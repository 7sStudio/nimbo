// Tests the environment: .env into the env built-in and process.env, keys that leave the file, the redaction set, and
// a .env that is not a regular file of at most 1 MiB (a directory, a FIFO (fixtures/fifo.ts), a larger file) refused at
// once as EnvUnreadable with the reason.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Environment, ProcessEnv } from "./environment.js";
import { createEnvironment } from "./environment.js";
import { makeFifo } from "./fixtures/fifo.js";

let workspace = "";
const writeEnv = (text: string): void => {
  writeFileSync(join(workspace, ".env"), text);
};

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "nimbo-env-"));
});
afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("createEnvironment", () => {
  it("reads .env into the env built-in and process.env, and a missing file as empty", () => {
    const processEnv: ProcessEnv = { HOME: "/home" };
    const environment: Environment = createEnvironment(workspace, processEnv);
    expect(Object.keys(environment.env)).toEqual([]);
    writeEnv("API_KEY=abcdefgh123\nHOME=/work\n");
    environment.reload();
    expect(environment.env.API_KEY).toBe("abcdefgh123");
    expect(processEnv).toEqual({ HOME: "/work", API_KEY: "abcdefgh123" });
  });

  it("gives a key that leaves the file its earlier process.env value, or removes it", () => {
    const processEnv: ProcessEnv = { HOME: "/home" };
    writeEnv("API_KEY=abcdefgh123\nHOME=/work\n");
    const environment = createEnvironment(workspace, processEnv);
    writeEnv("OTHER=1\n");
    environment.reload();
    expect(processEnv).toEqual({ HOME: "/home", OTHER: "1" });
  });

  it("redacts the non-public values of 8 characters or more", () => {
    writeEnv("SECRET=abcdefgh123\nPUBLIC_URL=https://example.com\nSHORT=3000\n");
    const { redact } = createEnvironment(workspace, {});
    expect(redact("abcdefgh123 https://example.com 3000")).toBe("*** https://example.com 3000");
  });
});

describe("createEnvironment with a .env that is not a regular file of at most 1 MiB", () => {
  it("refuses a .env that is a directory, a FIFO or over 1 MiB as EnvUnreadable with the reason", () => {
    const path = join(workspace, ".env");
    const refusal = (reason: string) => ({ name: "EnvUnreadable", data: { path, reason } });
    mkdirSync(path);
    expect(() => createEnvironment(workspace, {})).toThrow(
      expect.objectContaining(refusal("it is a directory, not a regular file")),
    );
    rmSync(path, { recursive: true });
    makeFifo(path);
    expect(() => createEnvironment(workspace, {})).toThrow(
      expect.objectContaining(refusal("it is a FIFO (a named pipe), not a regular file")),
    );
    rmSync(path);
    writeEnv(`BIG=${"x".repeat(1024 * 1024)}\n`);
    expect(() => createEnvironment(workspace, {})).toThrow(
      expect.objectContaining(refusal("it holds 1048581 bytes, over the 1048576 allowed")),
    );
  });
});
