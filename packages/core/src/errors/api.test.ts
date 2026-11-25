// Tests the API error catalogue of 03-api §7.4: codes, names and message snapshots.
import { describe, expect, it } from "vitest";

import {
  apiErrorCodes,
  apiErrorName,
  BridgeCallFailed,
  CellNotFound,
  Conflict,
  InterruptRefused,
  InvalidParams,
  KernelDead,
  NotAvailable,
  NotebookConflict,
  NotebookExists,
  NotebookNotFound,
  Unauthorized,
} from "./api.js";
import { NotebookOpen } from "./notebook.js";
import { PageTimeout, RealmAttached, RealmNotAttached } from "./realm.js";
import { isJsnbError } from "./jsnbError.js";

describe("apiErrorName", () => {
  it("maps every code of the table back to its name", () => {
    for (const [name, code] of Object.entries(apiErrorCodes)) expect(apiErrorName(code)).toBe(name);
    expect(apiErrorName(-32601)).toBeUndefined();
  });
});

const catalogue = [
  [new InvalidParams({ issues: [{ path: ["cell"], message: "expected string" }] }), -32602],
  [new NotebookNotFound({ path: "demo.jsnb" }), 1001],
  [new CellNotFound({ cell: "c_a1b2c3" }), 1002],
  [new KernelDead({ exitCode: 1 }), 1003],
  [new RealmNotAttached({ notebook: "demo.jsnb" }), 1004],
  [new NotebookExists({ path: "demo.jsnb" }), 1005],
  [new Unauthorized(), 1006],
  [new NotebookConflict({ path: "demo.jsnb" }), 1007],
  [new Conflict({ id: "c_a1b2c3" }), 1008],
  [new NotAvailable({ feature: "debug.pause" }), 1009],
  [new InterruptRefused({ context: "Timeout", cell: "c_a1b2c3" }), 1010],
  [new RealmAttached({ notebook: "demo.jsnb" }), 1011],
  [new PageTimeout({ notebook: "demo.jsnb", request: "realm.snapshot", timeoutMs: 5000 }), 1015],
  [new NotebookOpen({ path: "demo.jsnb" }), 1012],
  [new BridgeCallFailed({ error: { name: "TypeError", message: "x", frames: [], raw: "" } }), 2001],
] as const;

describe("the API errors", () => {
  it.each(catalogue)("$0.name carries code $1 and is a JsnbError", (error, code) => {
    expect(error.code).toBe(code);
    expect(isJsnbError(error)).toBe(true);
    expect(error.message).toMatchSnapshot();
  });

  it("names the first Zod issue and copes with no issues", () => {
    expect(new InvalidParams({ issues: [] }).message).toBe("Invalid params.");
    expect(new InvalidParams({ issues: [{ path: [], message: "bad" }] }).message).toBe(
      "Invalid params: bad",
    );
  });

  it("says how the kernel died when it knows", () => {
    expect(new KernelDead({ signal: "SIGKILL" }).message).toContain("(signal SIGKILL)");
    expect(new KernelDead().message).toBe(
      "The kernel is not running. Restart it with kernel.restart.",
    );
  });

  it("uses the exact REALM_NOT_ATTACHED message of 05-bridge §6", () => {
    expect(new RealmNotAttached({ notebook: "demo.jsnb" }).message).toBe(
      "No notebook page is open for demo.jsnb; open it in the browser to run client cells.",
    );
  });

  it("tells a notebook that is not open from one that does not exist", () => {
    expect(new NotebookNotFound({ path: "demo.jsnb", closed: true }).message).toBe(
      "demo.jsnb is not open. Open it with notebook.open first.",
    );
  });

  it("says not implemented yet for a planned key", () => {
    expect(new NotAvailable({ feature: "editor.keymap", planned: true }).message).toBe(
      "editor.keymap is not implemented yet.",
    );
  });

  it("attaches a cause", () => {
    const cause = new Error("disk");
    expect(new NotebookConflict({ path: "a.jsnb" }, { cause }).cause).toBe(cause);
  });
});

describe("InterruptRefused", () => {
  it.each(["Immediate", "TickObject", "AsyncResource", "Promise"] as const)(
    "says where %s code runs that an interrupt did not stop, with or without its cell",
    (context) => {
      expect(new InterruptRefused({ context, cell: "c_a1b2c3" }).message).toMatchSnapshot();
      expect(new InterruptRefused({ context }).message).toMatch(
        /^The running code was not stopped/,
      );
    },
  );
});
