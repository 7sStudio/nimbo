// Home's search and list order: every word must be found, a word in the name ranks before the folder,
// the title, a route and an export, the first word is marked where it sits in the name, notebooks not read yet are
// found by their path alone; the list keeps the folder picked and folds; the Workspace panel's folders read as a tree.
import type { NotebookEntry, NotebookSummary } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { searchNotebooks } from "./homeSearch.js";
import { folderRows, homeList } from "./homeView.js";

const entry = (path: string): NotebookEntry => ({
  path,
  open: false,
  modifiedAt: null,
  bytes: null,
});
const summary = (path: string, parts: Partial<NotebookSummary>): NotebookSummary => ({
  path,
  title: "",
  text: "",
  intro: "",
  titleCell: null,
  cells: [],
  routes: [],
  exports: [],
  packages: [],
  secrets: [],
  missing: [],
  lastResult: null,
  ...parts,
});
const notebooks = [
  "billing/refunds.jsnb",
  "payment-element.jsnb",
  "reports/payouts-by-week.jsnb",
  "repay.jsnb",
  "webhooks.jsnb",
  "zz.jsnb",
].map(entry);
const summaries = new Map<string, NotebookSummary | undefined>([
  ["webhooks.jsnb", summary("webhooks.jsnb", { title: "Stripe payloads", routes: ["POST /pay"] })],
  ["zz.jsnb", summary("zz.jsnb", { exports: ["createPayment"] })],
  ["billing/refunds.jsnb", summary("billing/refunds.jsnb", { title: "Refunds of a payment" })],
]);

describe("searchNotebooks", () => {
  it("ranks a name's start, then inside a name, then the title, a route and an export", () => {
    const found = searchNotebooks(notebooks, summaries, "pay");
    expect(found.matches.map((match) => match.path)).toEqual([
      "payment-element.jsnb",
      "reports/payouts-by-week.jsnb",
      "repay.jsnb",
      "billing/refunds.jsnb",
      "webhooks.jsnb",
      "zz.jsnb",
    ]);
    expect(found.matches[0]?.mark).toEqual({ from: 0, to: 3 });
    expect(found.matches[2]?.mark).toEqual({ from: 2, to: 5 });
    expect(found.matches[3]?.mark).toBeNull();
    expect(found.rest).toEqual([]);
  });

  it("needs every word, in any case, from any place, and keeps the rest in list order", () => {
    const found = searchNotebooks(notebooks, summaries, "  STRIPE   post ");
    expect(found.matches.map((match) => match.path)).toEqual(["webhooks.jsnb"]);
    expect(found.rest).toEqual(
      notebooks.map((each) => each.path).filter((p) => p !== "webhooks.jsnb"),
    );
    // a folder and the extension are part of the path; a notebook not read yet is found by its path alone
    const byPath = searchNotebooks(notebooks, new Map(), "reports/ .jsnb");
    expect(byPath.matches.map((match) => match.path)).toEqual(["reports/payouts-by-week.jsnb"]);
    expect(searchNotebooks(notebooks, summaries, "createpayment").matches).toHaveLength(1);
    expect(searchNotebooks(notebooks, summaries, "   ")).toEqual({
      matches: [],
      rest: notebooks.map((each) => each.path),
    });
  });
});

describe("homeList and folderRows", () => {
  it("keeps the folder picked, and while searching moves through the matches only", () => {
    const input = { notebooks, summaries, query: "", folder: "" };
    expect(homeList(input).order).toEqual([
      "payment-element.jsnb",
      "repay.jsnb",
      "webhooks.jsnb",
      "zz.jsnb",
      "billing/refunds.jsnb",
      "reports/payouts-by-week.jsnb",
    ]);
    expect(homeList({ ...input, folder: "reports" }).order).toEqual([
      "reports/payouts-by-week.jsnb",
    ]);
    expect(homeList({ ...input, query: "refund" }).order).toEqual(["billing/refunds.jsnb"]);
  });

  it("lists every folder with the folders above it, a folder followed by its own subfolders", () => {
    const rows = folderRows(["a-b/x.jsnb", "a/b/c/y.jsnb", "a/z.jsnb", "top.jsnb"].map(entry));
    expect(rows).toEqual([
      { folder: "a", depth: 0, count: 2 },
      { folder: "a/b", depth: 1, count: 1 },
      { folder: "a/b/c", depth: 2, count: 1 },
      { folder: "a-b", depth: 0, count: 1 },
    ]);
  });
});
