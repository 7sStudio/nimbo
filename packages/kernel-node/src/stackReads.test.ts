// Tests what the interrupt hook reads of the stack (04-kernel §6): user code (a cell's frame or the user-code frame)
// through Node's call sites and, beyond 200 frames, V8's stack trace API; the frames of code outside the cells,
// classified by file and named, each once, the first ten; the cell of the innermost cell frame. Frames come from
// functions compiled under script names of the test's choosing (fixtures/scripts.ts).
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { callUserCode, userCodeFrame } from "./builtins/userCode.js";
import { asCell, asScript, callScript, cellOf } from "./fixtures/scripts.js";
import {
  cellOnStack,
  isOutsideFrame,
  outsideFramesOnStack,
  userCodeOnStack,
} from "./stackReads.js";
import { kernelDirectories, ownCodeDirectories } from "./kernelFiles.js";

/** The hook's check with the user-code frame as the module calibrated it. */
const onStack = (): boolean => userCodeOnStack(userCodeFrame);

/** `check` called `depth` frames below the caller, through plain test code. */
const below = (depth: number, check: () => unknown): unknown =>
  depth === 0 ? check() : below(depth - 1, check);

describe("isOutsideFrame", () => {
  it("tells code outside the cells from the kernel's files, Node's, the cells' and frames with no script", () => {
    const kernelFile = `${kernelDirectories[0] ?? ""}src/child.ts`;
    const coreFile = `${kernelDirectories[1] ?? ""}src/index.ts`;
    const inside = [
      kernelFile,
      pathToFileURL(kernelFile).href,
      pathToFileURL(coreFile).href,
      "node:internal/timers",
      "jsnb:///test.jsnb/c_aaaaaa.ts",
      "",
    ];
    const outside = ["/w/lib/prices.mjs", "file:///w/node_modules/p/index.js", "file://host/x.js"];
    expect(inside.map((name) => isOutsideFrame(name, kernelDirectories))).toEqual(
      inside.map(() => false),
    );
    expect(outside.map((name) => isOutsideFrame(name, kernelDirectories))).toEqual(
      outside.map(() => true),
    );
  });
});

/** The directories of the kernel and of every package the repository installed: the test runner's are outside. */
const installed = [
  ...ownCodeDirectories,
  fileURLToPath(new URL("../../node_modules/", pathToFileURL(kernelDirectories[0] ?? ""))),
];

describe("outsideFramesOnStack", () => {
  it("names each frame of code outside the cells once, innermost first, the first ten", () => {
    const chain = Array.from({ length: 12 }, (_, n) =>
      n === 11
        ? "function f11() { return check() }"
        : `function f${String(n)}() { return f${String(n + 1)}() }`,
    );
    const source = `(function (check) { ${chain.join(" ")} return f0() })`;
    const frames = callScript("file:///w/lib/deep.mjs", source, [
      () => outsideFramesOnStack(installed),
    ]);
    expect(frames).toHaveLength(10);
    expect(frames).toEqual(
      Array.from({ length: 10 }, (_, n): unknown =>
        expect.stringMatching(
          new RegExp(`^f${String(11 - n)} \\(file:///w/lib/deep\\.mjs:1:\\d+\\)$`),
        ),
      ),
    );
  });

  it("names a frame of an anonymous function by its position, and a recursion's repeated frame once", () => {
    const source =
      "(function (n, check) { const r = (k) => (k === 0 ? check() : r(k - 1)); return r(n) })";
    const frames = callScript("file:///w/lib/rec.mjs", source, [
      5,
      () => outsideFramesOnStack(installed),
    ]);
    expect(frames).toEqual([
      expect.stringMatching(/^r \(file:\/\/\/w\/lib\/rec\.mjs:1:\d+\)$/),
      expect.stringMatching(/^r \(file:\/\/\/w\/lib\/rec\.mjs:1:\d+\)$/),
      expect.stringMatching(/^file:\/\/\/w\/lib\/rec\.mjs:1:\d+$/),
    ]);
    expect(outsideFramesOnStack(installed)).toEqual([]);
  });
});

describe("cellOnStack", () => {
  it("finds the cell of the innermost cell frame, and none without one or for a script it does not know", () => {
    const inner = (): unknown =>
      asScript("jsnb:///test.jsnb/c_bbbbbb.ts", () =>
        cellOnStack((url) => (url.endsWith("c_bbbbbb.ts") ? "c_bbbbbb" : cellOf(url))),
      );
    expect([
      asCell(() => cellOnStack(cellOf)),
      asCell(inner),
      cellOnStack(cellOf),
      asCell(() => cellOnStack(() => undefined)),
    ]).toEqual(["c_aaaaaa", "c_bbbbbb", undefined, undefined]);
  });
});

describe("userCodeOnStack", () => {
  it("finds a cell's frame or the user-code frame on the stack, and none in plain code", () => {
    expect(onStack()).toBe(false);
    expect(asCell(onStack)).toBe(true);
    expect(asCell(() => below(10, onStack))).toBe(true);
    expect(callUserCode(onStack, undefined, [])).toBe(true);
    expect(callUserCode(() => userCodeOnStack(undefined), undefined, [])).toBe(false);
  });

  it("finds a cell's frame or the user-code frame more than 200 frames down, and restores the settings", () => {
    const settings = (): unknown[] => [
      Reflect.get(Error, "prepareStackTrace"),
      Reflect.get(Error, "stackTraceLimit"),
    ];
    const before = settings();
    expect(asCell(() => below(300, onStack))).toBe(true);
    expect(callUserCode(() => below(300, onStack), undefined, [])).toBe(true);
    expect(below(300, onStack)).toBe(false);
    expect(settings()).toEqual(before);
  });
});

/** Runs `fn` with `target`'s own `key` defined by `descriptor`, putting the original back however `fn` ends. */
function withOwn<T>(target: object, key: string, descriptor: PropertyDescriptor, fn: () => T): T {
  const own = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, descriptor);
  try {
    return fn();
  } finally {
    if (own) Object.defineProperty(target, key, own);
    else Reflect.deleteProperty(target, key);
  }
}

/** The cell's frame 300 frames below the stack check. */
const deep = (): unknown => asCell(() => below(300, onStack));

/** Error's two statics as the stack trace API sees them. */
const statics = (): unknown[] => [
  Reflect.get(Error, "prepareStackTrace"),
  Reflect.get(Error, "stackTraceLimit"),
];

describe("userCodeOnStack beyond 200 frames, when reading there would run a cell's code", () => {
  it("does not read deeper when either of Error's statics is an accessor, and never calls its getter", () => {
    const before = statics();
    const reads: string[] = [];
    const accessor = (key: string): PropertyDescriptor => ({
      get: () => reads.push(key),
      set: () => undefined,
      configurable: true,
    });
    const deeper = ["prepareStackTrace", "stackTraceLimit"].map((key) =>
      withOwn(Error, key, accessor(key), deep),
    );
    expect([deeper, reads, deep(), statics()]).toEqual([[false, false], [], true, before]);
  });

  it("does not read deeper when the global Error is no longer Node's, whose prepareStackTrace Node reads", () => {
    const replaced = { value: {}, configurable: true, writable: true };
    // Nothing but the read runs while the global binding is replaced: the test runner's own errors need Error.
    const deeper = withOwn(globalThis, "Error", replaced, deep);
    expect([deeper, deep()]).toEqual([false, true]);
  });
});
