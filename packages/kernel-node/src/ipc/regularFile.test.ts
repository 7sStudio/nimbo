// Tests the regular-file reads and writes of 04-kernel §2, §8.1 and §10 against real files of every kind: a regular
// file read whole and written, a missing one, a FIFO of fixtures/fifo.ts (refused at once for reading and for writing,
// never opened for writing), a directory, a device (a symbolic link to /dev/null) and a file over the size allowed;
// and a symbolic link, which the .env read follows and the loader's read and write refuse. The synchronous read of an
// open file starts from its fstat size and grows its buffer while the file is longer, as when it grew after its fstat
// (a smaller size given), up to the size allowed.
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeFifo } from "../fixtures/fifo.js";
import {
  readRegularFile,
  readRegularFileSync,
  readToEndSync,
  writeRegularFile,
} from "./regularFile.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nimbo-files-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const at = (name: string): string => join(dir, name);
const fifo = (name: string): string => {
  makeFifo(at(name));
  return at(name);
};

describe("readRegularFileSync and readRegularFile", () => {
  it("read a regular file whole, and a missing one as missing", async () => {
    writeFileSync(at("env"), "A=1\n");
    expect(readRegularFileSync(at("env"), 16)).toEqual({ kind: "read", text: "A=1\n" });
    expect(await readRegularFile(at("env"), 16)).toEqual({ kind: "read", text: "A=1\n" });
    expect(readRegularFileSync(at("none"), 16)).toEqual({ kind: "missing" });
    expect(await readRegularFile(at("none"), 16)).toEqual({ kind: "missing" });
  });

  it("refuse a FIFO with no writer at once, a directory, a device and a file over the size allowed", async () => {
    mkdirSync(at("folder"));
    symlinkSync("/dev/null", at("device"));
    writeFileSync(at("big"), "x".repeat(17));
    const reasons = {
      fifo: "it is a FIFO (a named pipe), not a regular file",
      folder: "it is a directory, not a regular file",
      device: "it is a device, not a regular file",
      big: "it holds 17 bytes, over the 16 allowed",
    };
    for (const [name, reason] of Object.entries(reasons)) {
      const path = name === "fifo" ? fifo(name) : at(name);
      // The loader's read refuses the device's link itself: it never follows one.
      const loaders = name === "device" ? "it is a symbolic link, not a regular file" : reason;
      expect(readRegularFileSync(path, 16)).toEqual({ kind: "refused", reason });
      expect(await readRegularFile(path, 16)).toEqual({ kind: "refused", reason: loaders });
    }
  });

  it("differ on a symbolic link to a regular file: the .env read follows it, the loader's refuses it", async () => {
    writeFileSync(at("target"), "A=1\n");
    symlinkSync(at("target"), at("link"));
    expect(readRegularFileSync(at("link"), 16)).toEqual({ kind: "read", text: "A=1\n" });
    expect(await readRegularFile(at("link"), 16)).toEqual({
      kind: "refused",
      reason: "it is a symbolic link, not a regular file",
    });
  });
});

describe("readToEndSync", () => {
  /** readToEndSync over a fresh descriptor of `name`, given `size` as its fstat size. */
  const readWith = (name: string, size: number, maxBytes: number) => {
    const fd = openSync(at(name), "r");
    try {
      return readToEndSync(fd, size, maxBytes);
    } finally {
      closeSync(fd);
    }
  };

  it("reads to the end from the fstat size, and from a smaller one by growing its buffer", () => {
    const text = "é".repeat(50); // 100 bytes of UTF-8, a character split wherever a buffer ends
    writeFileSync(at("env"), text);
    writeFileSync(at("empty"), "");
    for (const size of [100, 7, 0]) {
      expect(readWith("env", size, 100)).toEqual({ kind: "read", text });
    }
    expect(readWith("empty", 0, 16)).toEqual({ kind: "read", text: "" });
  });

  it("refuses a file that grew past the size allowed since its fstat", () => {
    writeFileSync(at("env"), "x".repeat(100));
    expect(readWith("env", 7, 99)).toEqual({
      kind: "refused",
      reason: "it grew over the 99 bytes allowed while it was read",
    });
  });
});

describe("writeRegularFile", () => {
  it("writes an absent or regular file, and refuses a FIFO or a directory without opening it for writing", async () => {
    expect(await writeRegularFile(at("loader"), "one")).toBeUndefined();
    expect(await writeRegularFile(at("loader"), "two")).toBeUndefined();
    expect(readFileSync(at("loader"), "utf8")).toBe("two");
    mkdirSync(at("folder"));
    expect(await writeRegularFile(fifo("pipe"), "x")).toBe(
      "it is a FIFO (a named pipe), not a regular file",
    );
    expect(await writeRegularFile(at("folder"), "x")).toBe("it is a directory, not a regular file");
  });

  it("refuses a symbolic link, leaving the file it points to as it was", async () => {
    writeFileSync(at("target"), "the user's");
    symlinkSync(at("target"), at("link"));
    expect(await writeRegularFile(at("link"), "x")).toBe(
      "it is a symbolic link, not a regular file",
    );
    expect(readFileSync(at("target"), "utf8")).toBe("the user's");
  });

  it("gives the reason of a write the system refuses", async () => {
    expect(await writeRegularFile(join(dir, "no", "such", "folder"), "x")).toMatch(/ENOENT/);
  });
});
