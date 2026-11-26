// notebook.summary on a real daemon: a closed notebook is read from its file without opening it (no
// kernel, no session, the file untouched), named and summed up by transform's real analysis; an open one from its
// session, so an edit shows at once; and the path rules every command follows refuse a ref outside the workspace, a
// file that is not there and a file the app cannot load.
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { withDaemon } from "../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

const at = "2026-11-15T14:02:00.000Z";
const file = {
  version: 1,
  jsnb: "0.0.0",
  cells: [
    {
      id: "c_intro1",
      type: "markdown",
      source: ["# Payment Element playground", "", "Create a **PaymentIntent** on the server."],
    },
    {
      id: "c_strip1",
      type: "server",
      source: [
        'import Stripe from "stripe";',
        'import { readFile } from "node:fs/promises";',
        'import { join } from "path";',
        'import { prices } from "./lib/prices.ts";',
        "export const stripe = new Stripe(env.STRIPE_SECRET_KEY);",
      ],
      meta: { lastEdit: { by: "user", client: "ui", at } },
    },
    {
      id: "c_intent",
      type: "server",
      source: [
        "export async function createIntent(amount: number) {",
        "  return stripe.paymentIntents.create({ amount: amount * 2 });",
        "}",
      ],
      meta: {
        lastEdit: {
          by: "agent",
          client: "mcp",
          agent: "claude-code",
          at,
          review: {
            previousSource:
              "export async function createIntent(amount: number) {\n  return stripe.paymentIntents.create({ amount });\n}",
            previousType: "server",
          },
        },
      },
    },
    {
      id: "c_route1",
      type: "server",
      source: [
        'route("POST /webhook", async (req) => {',
        '  if (env.has("WEBHOOK_SECRET")) {}',
        "});",
      ],
    },
    {
      id: "c_mount1",
      type: "client",
      source: ['const { loadStripe } = await import("@stripe/stripe-js/pure");'],
    },
    { id: "c_typing", type: "client", source: ["function mount() {", "const x = ("] },
  ],
};

/** Writes the notebook above as pay.jsnb, with stripe installed (a package.json in node_modules is what a run's
 * pre-flight looks for) and stripe-js not; answers its text. */
async function payNotebook(ws: { readonly path: (name: string) => string }): Promise<string> {
  const text = `${JSON.stringify(file, null, 2)}\n`;
  await writeFile(ws.path("pay.jsnb"), text);
  await mkdir(ws.path("node_modules/stripe"), { recursive: true });
  await writeFile(ws.path("node_modules/stripe/package.json"), '{ "name": "stripe" }\n');
  return text;
}

describe("notebook.summary of a closed notebook", () => {
  it("reads its file without opening it: title, text, cells, routes, exports, packages and env names", async () => {
    await withDaemon(async (daemon, ws) => {
      const text = await payNotebook(ws);
      const { summary } = await daemon.client.notebook.summary({ path: "pay.jsnb" });
      expect(summary).toMatchObject({
        path: "pay.jsnb",
        title: "Payment Element playground",
        text: "Create a PaymentIntent on the server.",
        titleCell: 1,
        routes: ["POST /webhook"],
        exports: ["stripe", "createIntent"],
        packages: ["stripe", "@stripe/stripe-js"],
        secrets: ["STRIPE_SECRET_KEY", "WEBHOOK_SECRET"],
      });
      expect(summary.cells.map((cell) => [cell.type, cell.name])).toEqual([
        ["markdown", "Payment Element playground"],
        ["server", "stripe"],
        ["server", "createIntent"],
        ["server", "POST /webhook"],
        ["client", "loadStripe"],
        // a cell that does not parse: what its text declares
        ["client", "mount, x"],
      ]);
      expect(summary.cells[2]?.lastEdit).toEqual({
        by: "agent",
        client: "mcp",
        agent: "claude-code",
        at,
        unreviewed: true,
        lines: [{ from: 2, to: 2 }],
      });
      expect(summary.cells[1]?.lastEdit).toMatchObject({ by: "user", unreviewed: false });
      expect(summary.cells[3]?.line).toBe('route("POST /webhook", async (req) => {');
      // nothing was opened, and the file is as it was
      const { notebooks } = await daemon.client.workspace.info();
      expect(notebooks).toMatchObject([{ path: "pay.jsnb", open: false }]);
      expect(await readFile(ws.path("pay.jsnb"), "utf8")).toBe(text);
    });
  });
});

describe("notebook.summary's peek at a closed notebook", () => {
  it("says each cell's size and first lines, the intro as written, the packages not installed, and no result", async () => {
    await withDaemon(async (daemon, ws) => {
      await payNotebook(ws);
      const { summary } = await daemon.client.notebook.summary({ path: "pay.jsnb" });
      expect(summary).toMatchObject({
        intro: "Create a **PaymentIntent** on the server.",
        missing: ["@stripe/stripe-js"],
        // a file holds no outputs
        lastResult: null,
      });
      expect(summary.cells[2]).toMatchObject({
        lines: 3,
        peek: [
          "export async function createIntent(amount: number) {",
          "  return stripe.paymentIntents.create({ amount: amount * 2 });",
          "}",
        ],
      });
      expect(summary.cells[0]).toMatchObject({
        lines: 3,
        peek: ["Create a PaymentIntent on the server."],
      });
    });
  });
});

describe("notebook.summary of an open notebook", () => {
  it("reads its session, so an edit shows at once", async () => {
    await withDaemon(async (daemon) => {
      const { client } = daemon;
      await client.notebook.create({ path: "live.jsnb" });
      await client.cell.add({
        notebook: "live.jsnb",
        type: "server",
        source: "export const a = 1",
      });
      const { summary } = await client.notebook.summary({ path: "live.jsnb" });
      expect(summary).toMatchObject({
        title: "",
        titleCell: null,
        exports: ["a"],
        lastResult: null,
      });
      expect(summary.cells).toMatchObject([
        { type: "server", name: "a", line: "export const a = 1" },
      ]);
    });
  });
});

describe("notebook.summary's last result", () => {
  it("is what an open notebook's runs hold: the kernel's own repr of the value, not what was printed", async () => {
    await withDaemon(async (daemon) => {
      const { client } = daemon;
      await client.notebook.create({ path: "live.jsnb" });
      const { execution } = await client.cell.add({
        notebook: "live.jsnb",
        type: "server",
        source: 'console.log("ready");\n({ total: 41 + 1, currency: "eur" })',
        run: true,
      });
      expect(execution?.status).toBe("ok");
      const { summary } = await client.notebook.summary({ path: "live.jsnb" });
      expect(summary.lastResult).toMatchObject({
        cell: 1,
        kind: "value",
        lines: ["{ total: 42, currency: 'eur' }"],
      });
    });
  });
});

describe("notebook.summary of a ref it cannot read", () => {
  it("is refused outside the workspace, NOTEBOOK_NOT_FOUND with no file, and the parser's error for a newer file", async () => {
    await withDaemon(async (daemon, ws) => {
      const { client } = daemon;
      await expect(client.notebook.summary({ path: "../out.jsnb" })).rejects.toMatchObject({
        code: -32602,
      });
      await expect(client.notebook.summary({ path: "gone.jsnb" })).rejects.toMatchObject({
        code: 1001,
      });
      await writeFile(ws.path("new.jsnb"), '{ "version": 99, "cells": [] }\n');
      await expect(client.notebook.summary({ path: "new.jsnb" })).rejects.toMatchObject({
        data: { name: "NewerVersion" },
      });
    });
  });
});
