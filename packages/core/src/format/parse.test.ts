// Tests parse: the fixture, ids, duplicates, unknown keys, validation messages and refused versions.
import { beforeAll, describe, expect, it } from "vitest";

import { createIdGenerator } from "../model/ids.js";
import v1 from "./fixtures/notebooks/v1.jsnb?raw";
import { parse } from "./parse.js";

/** Deterministic and varying: the k-th call yields k / 36 for each character, so ids repeat after 36 cells. */
const counting = () => {
  let k = 0;
  return createIdGenerator(() => {
    k = (k + 1) % 36;
    return k / 36;
  });
};
const ids = counting();
const text = (value: unknown) => JSON.stringify(value);

/** The first parse compiles the Zod schemas; that belongs to the module, not to a test. */
beforeAll(() => {
  parse(text({ version: 1, cells: [] }), { ids });
});

describe("parse", () => {
  it("reads the 07-file-format §2 example", () => {
    const result = parse(v1, { ids, path: "demo.jsnb" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ warnings: [], migrated: false, assignedIds: false });
    expect(result.value.doc.cells.map((c) => c.id)).toEqual(["c_a1b2c3", "c_d4e5f6", "c_g7h8i9"]);
    expect(result.value.doc.cells[0]?.source).toBe(
      'import Stripe from "stripe";\nexport const stripe = new Stripe(env.STRIPE_SECRET_KEY);',
    );
    expect(result.value.doc.cells[1]?.meta).toEqual({});
    expect(result.value.doc.jsnb).toBe("0.1.0");
  });

  it("assigns a fresh id that does not collide and accepts a string source", () => {
    const fresh = counting();
    const taken = fresh.cell();
    const cells = [
      { id: taken, type: "server", source: "a\nb" },
      { type: "markdown", source: ["x"] },
    ];
    const result = parse(text({ version: 1, cells }), { ids: counting() });
    expect(result.ok && result.value.assignedIds).toBe(true);
    const got = result.ok ? result.value.doc.cells.map((c) => c.id) : [];
    expect(got[0]).toBe(taken);
    expect(got[1]).toMatch(/^c_[0-9a-z]{6}$/);
    expect(got[1]).not.toBe(taken);
    expect(result.ok && result.value.doc.cells[0]?.source).toBe("a\nb");
  });

  it("refuses duplicate ids and names both positions", () => {
    const cell = { id: "c_a1b2c3", type: "server", source: [] };
    const result = parse(text({ version: 1, cells: [cell, { ...cell, type: "client" }, cell] }), {
      ids,
    });
    expect(!result.ok && result.error.name).toBe("DuplicateCellId");
    expect(!result.ok && result.error.data).toEqual({ id: "c_a1b2c3", positions: [0, 1, 2] });
  });
});

describe("parse of unknown keys", () => {
  it("keeps them at every level and reports each once", () => {
    const file = {
      version: 1,
      cells: [{ id: "c_a1b2c3", type: "server", source: [], meta: { color: "red" }, pinned: true }],
      attachments: {},
    };
    const result = parse(text(file), { ids });
    expect(result.ok && result.value.warnings).toEqual([
      "unknown key attachments kept",
      "unknown key cells[0].pinned kept",
      "unknown key cells[0].meta.color kept",
    ]);
    expect(result.ok && result.value.doc.extra).toEqual({ attachments: {} });
    expect(result.ok && result.value.doc.cells[0]?.extra).toEqual({ pinned: true });
    expect(result.ok && result.value.doc.cells[0]?.meta).toEqual({ color: "red" });
  });
});

describe("parse of invalid files", () => {
  it("names the path of the first validation issue", () => {
    const result = parse(text({ version: 1, cells: [{ type: "server", source: [1] }] }), {
      ids,
      path: "demo.jsnb",
    });
    expect(!result.ok && result.error.message).toBe(
      "demo.jsnb: cells[0].source[0]: expected string",
    );
    const line = parse(text({ version: 1, cells: [{ type: "server", source: ["a\nb"] }] }), {
      ids,
    });
    expect(!line.ok && line.error.message).toBe(
      "cells[0].source[0]: a source line must not contain a newline",
    );
  });

  it("refuses a JSON syntax error, a non-object and a missing version", () => {
    const broken = parse("{ version: 1 }", { ids });
    expect(!broken.ok && broken.error.name).toBe("InvalidNotebook");
    expect(!broken.ok && broken.error.message).toMatch(/^not valid JSON \(/);
    const list = parse("[1]", { ids });
    expect(!list.ok && list.error.message).toBe("expected an object");
    const missing = parse(text({ cells: [] }), { ids });
    expect(!missing.ok && missing.error.message).toBe("version: expected number");
    const zero = parse(text({ version: 0, cells: [] }), { ids });
    expect(!zero.ok && zero.error.name).toBe("InvalidNotebook");
    expect(!zero.ok && zero.error.message).toMatch(/^version: /);
  });
});

describe("parse of newer versions", () => {
  it("refuses them with the 07-file-format §4 message", () => {
    const result = parse(text({ version: 3, cells: [] }), {
      ids,
      path: "payment-element.jsnb",
      appVersion: "0.4.0",
    });
    expect(!result.ok && result.error.name).toBe("NewerVersion");
    expect(!result.ok && result.error.message).toBe(
      "payment-element.jsnb is version 3; this nimbo (0.4.0) reads up to version 1. Update nimbo.",
    );
    const bare = parse(text({ version: 2 }), { ids });
    expect(!bare.ok && bare.error.message).toBe(
      "notebook is version 2; this nimbo (unknown) reads up to version 1. Update nimbo.",
    );
  });
});
