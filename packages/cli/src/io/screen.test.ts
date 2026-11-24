// The questions the install commands ask: answered from a terminal's lines, defaults on Enter, a re-ask on a wrong
// answer, and no question at all (the command's fallback) without a terminal or under --yes.
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { testIo } from "../fixtures/io.js";
import { openScreen } from "./screen.js";

const terminal = (stdin: string, env: Record<string, string> = {}) =>
  testIo({ cwd: "/", stdin, isTTY: true, outputIsTTY: true, env: { LANG: "en_US.UTF-8", ...env } });

describe("the screen's questions at a terminal", () => {
  it("reads one answer per question, Enter taking the default, and re-asks after a wrong one", async () => {
    const io = terminal("\nmaybe\nn\n7\n2\n1 3\n\n");
    const screen = openScreen(io, "test");
    expect(await screen.confirm("Go?", { default: true })).toBe(true);
    expect(await screen.confirm("Really?", { default: true })).toBe(false);
    expect(await screen.choose("Which?", [{ label: "a" }, { label: "b" }], { default: 0 })).toBe(1);
    const picks = [
      { label: "x", checked: true },
      { label: "y", checked: false },
      { label: "z", checked: false },
    ];
    expect(await screen.chooseMany("Which ones?", picks)).toEqual([false, false, true]);
    screen.close();
    expect(io.out()).toContain("Type y or n.");
    expect(io.out()).toContain("Type a number from 1 to 2.");
  });

  it("ends the questions when stdin ends, as a cancel", async () => {
    const screen = openScreen(terminal(""), "test");
    await expect(screen.confirm("Go?", { default: true })).rejects.toThrow(/Cancelled/u);
    screen.close();
  });

  it("ends a question on Ctrl-C", async () => {
    const io = testIo({ cwd: "/", isTTY: true, outputIsTTY: true });
    const screen = openScreen({ ...io, stdin: new PassThrough() }, "test");
    const asked = screen.confirm("Go?", { default: true });
    await io.untilOut((text) => text.includes("Go?"));
    io.signal("SIGINT");
    await expect(asked).rejects.toThrow(/Interrupted/u);
    expect(screen.signal.aborted).toBe(true);
    screen.close();
  });
});

describe("the screen without questions", () => {
  it("takes each fallback unasked without a terminal, under --yes and under --json, and writes no escape", async () => {
    for (const io of [
      testIo({ cwd: "/", stdin: "n\n", isTTY: false, outputIsTTY: false }),
      testIo({ cwd: "/", stdin: "n\n", isTTY: true, outputIsTTY: false }),
    ]) {
      const screen = openScreen(io, "test");
      expect(screen.interactive).toBe(false);
      expect(await screen.confirm("Go?", { default: false, fallback: true })).toBe(true);
      expect(await screen.choose("Which?", [{ label: "a" }, { label: "b" }], { default: 1 })).toBe(
        1,
      );
      await screen.step("ok", "Done", "detail");
      screen.close();
      expect(io.out()).toBe("  + Done  detail\n");
    }
    for (const options of [{ yes: true }, { json: true }]) {
      const screen = openScreen(terminal("n\n"), "test", options);
      expect(await screen.confirm("Go?", { default: true })).toBe(true);
      screen.close();
    }
  });
});

describe("the screen's colour and marks", () => {
  it("paints on a terminal unless NO_COLOR or TERM=dumb, and uses ASCII marks outside UTF-8", async () => {
    const painted = terminal("");
    const screen = openScreen(painted, "test", { yes: true });
    await screen.step("ok", "Done");
    screen.close();
    expect(painted.out()).toContain("\u001b[32m✓\u001b[0m");
    for (const env of [{ NO_COLOR: "1" }, { TERM: "dumb" }]) {
      const io = terminal("", env);
      const plain = openScreen(io, "test", { yes: true });
      await plain.step("fail", "Failed");
      plain.close();
      expect(io.out()).not.toContain("\u001b[");
    }
    const ascii = terminal("", { LANG: "C", NO_COLOR: "1" });
    const screen2 = openScreen(ascii, "test", { yes: true });
    await screen2.step("fail", "Failed");
    screen2.close();
    expect(ascii.out()).toBe("  x Failed\n");
  });
});
