// Tests the workspace loader of 04-kernel §8.1: written when missing or different, left alone when current, and a
// loader path that is no regular file (a directory, a FIFO (fixtures/fifo.ts)) refused at once as LoaderWriteFailed;
// a loader or a .jsnb that is a symbolic link to something outside the workspace refused, the target left as it was.
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeFifo } from "../fixtures/fifo.js";
import { loaderSource, writeLoader } from "./loader.js";

let workspace = "";

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "nimbo-loader-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const loaderPath = () => join(workspace, ".jsnb", "loader.mjs");

describe("writeLoader", () => {
  it("writes .jsnb/loader.mjs with its one export, creating the folder", async () => {
    expect(await writeLoader(workspace)).toBe(loaderPath());
    expect(readFileSync(loaderPath(), "utf8")).toBe(loaderSource);
    expect(loaderSource).toContain("export const load = (specifier) => import(specifier);");
  });

  it("rewrites a loader that differs and leaves a current one untouched", async () => {
    mkdirSync(join(workspace, ".jsnb"));
    writeFileSync(loaderPath(), "export const load = () => null;\n");
    await writeLoader(workspace);
    expect(readFileSync(loaderPath(), "utf8")).toBe(loaderSource);
    const written = statSync(loaderPath()).mtimeMs;
    await writeLoader(workspace);
    expect(statSync(loaderPath()).mtimeMs).toBe(written);
  });

  it("refuses a loader path that is a directory or a FIFO as LoaderWriteFailed with the reason", async () => {
    mkdirSync(loaderPath(), { recursive: true });
    await expect(writeLoader(workspace)).rejects.toMatchObject({
      name: "LoaderWriteFailed",
      data: { path: loaderPath(), reason: "it is a directory, not a regular file" },
    });
    rmSync(loaderPath(), { recursive: true });
    makeFifo(loaderPath());
    await expect(writeLoader(workspace)).rejects.toMatchObject({
      name: "LoaderWriteFailed",
      data: { path: loaderPath(), reason: "it is a FIFO (a named pipe), not a regular file" },
    });
  });

  it("reports a .jsnb that is not a folder as LoaderWriteFailed with the reason", async () => {
    writeFileSync(join(workspace, ".jsnb"), "");
    await expect(writeLoader(workspace)).rejects.toMatchObject({
      name: "LoaderWriteFailed",
      data: { path: loaderPath(), reason: "its folder .jsnb is not a directory" },
    });
  });
});

describe("writeLoader and symbolic links", () => {
  it("refuses a loader that is one, or a .jsnb that is one, leaving what they point to as it was", async () => {
    const outside = mkdtempSync(join(tmpdir(), "nimbo-outside-"));
    try {
      writeFileSync(join(outside, "user.mjs"), "the user's");
      mkdirSync(join(workspace, ".jsnb"));
      symlinkSync(join(outside, "user.mjs"), loaderPath());
      await expect(writeLoader(workspace)).rejects.toMatchObject({
        name: "LoaderWriteFailed",
        data: { path: loaderPath(), reason: "it is a symbolic link, not a regular file" },
      });
      rmSync(join(workspace, ".jsnb"), { recursive: true });
      symlinkSync(outside, join(workspace, ".jsnb"));
      await expect(writeLoader(workspace)).rejects.toMatchObject({
        data: { reason: "its folder .jsnb is a symbolic link" },
      });
      expect([readFileSync(join(outside, "user.mjs"), "utf8"), readdirSync(outside)]).toEqual([
        "the user's",
        ["user.mjs"],
      ]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("gives the reason .jsnb cannot be looked at", async () => {
    const file = join(workspace, "file");
    writeFileSync(file, "");
    await expect(writeLoader(file)).rejects.toMatchObject({
      data: { reason: expect.stringMatching(/ENOTDIR/) as unknown },
    });
  });
});
