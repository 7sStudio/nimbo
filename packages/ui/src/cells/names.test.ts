// A cell's name and description from what the notebook knows of it: a route, exports, definitions, a heading, a line.
import type { Route } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { aboutOf, nameOf, namesOf } from "./names.js";

const entry = (parts: Partial<Record<"defines" | "uses" | "exports", string[]>>) => ({
  defines: parts.defines ?? [],
  uses: parts.uses ?? [],
  exports: parts.exports ?? [],
  dependsOn: [],
});
const route = (cell: string, spec: string): Route => {
  const [method = "GET", path = "/"] = spec.split(" ");
  return { cell, method, path, spec, url: `http://127.0.0.1:1${path}`, registeredAt: "", hits: 0 };
};
const server = (id: string, source: string) => ({ id, type: "server" as const, source });

describe("nameOf", () => {
  it("names a cell by its route, then its exports, then what it defines", () => {
    const cell = server("a", 'route("POST /webhook", handler)');
    expect(nameOf(cell, entry({ defines: ["handler"] }), [route("a", "POST /webhook")])).toBe(
      "POST /webhook",
    );
    expect(nameOf(cell, entry({ exports: ["createIntent"], defines: ["x"] }), [])).toBe(
      "createIntent",
    );
    expect(nameOf(cell, entry({ defines: ["stripe", "balance"] }), [])).toBe("stripe, balance");
    expect(nameOf(cell, entry({ defines: ["a", "b", "c", "d", "e"] }), [])).toBe(
      "a, b, c and 2 more",
    );
  });

  it("takes the first line only with cells.titleFromFirstLine, cut, and says empty for no text", () => {
    const line = { firstLine: true };
    expect(nameOf(server("a", "\n  await sync()  \n"), undefined, [])).toBe("");
    expect(nameOf(server("a", "\n  await sync()  \n"), undefined, [], line)).toBe("await sync()");
    expect(nameOf(server("a", `log("${"x".repeat(80)}")`), entry({}), [], line)).toHaveLength(60);
    expect(nameOf(server("a", "  \n"), undefined, [], line)).toBe("empty");
  });

  it("names a markdown cell by its heading without the marks", () => {
    const prose = { id: "m", type: "markdown" as const, source: "\n## Payment playground\ntext" };
    expect(nameOf(prose, undefined, [])).toBe("Payment playground");
    expect(nameOf({ ...prose, source: "" }, undefined, [])).toBe("empty");
  });
});

describe("aboutOf", () => {
  const context = { routes: [route("r", "GET /ping")], exporters: new Map([["createIntent", 3]]) };

  it("says what the cell is to the rest of the notebook", () => {
    expect(aboutOf(server("r", ""), entry({}), context)).toBe("HTTP route");
    expect(aboutOf(server("s", ""), entry({ exports: ["createIntent"] }), context)).toBe(
      "exported to client cells",
    );
    expect(aboutOf(server("s", ""), entry({ defines: ["x"] }), context)).toBe("");
    const client = { id: "c", type: "client" as const, source: "" };
    expect(aboutOf(client, entry({ uses: ["x", "createIntent"] }), context)).toBe(
      "calls createIntent from cell 3",
    );
    expect(aboutOf(client, undefined, context)).toBe("");
    expect(aboutOf({ id: "m", type: "markdown", source: "# t" }, undefined, context)).toBe("");
  });
});

describe("namesOf", () => {
  it("maps every cell to its name", () => {
    const names = namesOf(
      [server("a", "const x = 1"), server("b", "x")],
      new Map([["a", entry({ defines: ["x"] })]]),
      [],
    );
    expect([...names]).toEqual([
      ["a", "x"],
      ["b", ""],
    ]);
  });
});
