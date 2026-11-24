// The routes suite, a route's life (04-kernel §7, §8; 03-api §4.3, §4.4; 02-architecture §6): the same spec from another
// cell replaces it; a re-run disposes it before registering again; a cell edited not to register one any more leaves
// none; a cell switched to markdown or client loses it; an interrupt keeps it; a kernel restart and a daemon restart lose it (deleting the cell: deleted.integration).
import { startDaemon } from "../../../fixtures/daemon.js";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { createNotebook } from "../../../fixtures/notebook.js";
import { rawHttp } from "../../../fixtures/raw.js";
import { withRoutes } from "../../../fixtures/routes.js";

describe("the same spec from another cell", () => {
  it("replaces the route; the first cell's disposal leaves it, its re-run takes it back", async () => {
    await withRoutes(async ({ daemon, notebook, cell, rerun, send, routes, changed }) => {
      const first = await cell('route("POST /hook", () => "first")');
      const second = await cell('route("post /hook", () => "second")');
      await changed((list) => list.length === 1 && list[0]?.cell === second);
      expect((await send("/hook", { method: "POST" })).body).toBe("second");
      expect((await routes()).map((route) => route.cell)).toEqual([second]);
      await daemon.client.cell.update({ notebook, cell: first, source: "1" });
      await rerun(first);
      expect((await send("/hook", { method: "POST" })).body).toBe("second");
      await daemon.client.cell.update({
        notebook,
        cell: first,
        source: 'route("POST /hook", () => "back")',
      });
      await rerun(first);
      expect((await send("/hook", { method: "POST" })).body).toBe("back");
      expect((await routes()).map((route) => route.cell)).toEqual([first]);
    });
  });
});

describe("a re-run", () => {
  it("disposes the cell's routes before its code runs again: a new handler, a new registeredAt, hits from 0", async () => {
    await withRoutes(async ({ daemon, notebook, cell, rerun, send, routes, changes }) => {
      const id = await cell('route("GET /v", () => "one")');
      expect((await send("/v")).body).toBe("one");
      const [before] = await routes();
      expect(before?.hits).toBe(1);
      await daemon.client.cell.update({
        notebook,
        cell: id,
        source: 'route("GET /v", () => "two")',
      });
      await rerun(id);
      const [after] = await routes();
      expect(after).toMatchObject({ spec: "GET /v", cell: id, hits: 0 });
      expect(Date.parse(after?.registeredAt ?? "")).toBeGreaterThanOrEqual(
        Date.parse(before?.registeredAt ?? ""),
      );
      expect((await send("/v")).body).toBe("two");
      const sizes = changes().map((event) => event.data.routes.length);
      expect(sizes.slice(sizes.lastIndexOf(0) - 1, sizes.lastIndexOf(0) + 2)).toEqual([1, 0, 1]);
    });
  });

  it("of a cell edited to register no route leaves none: the path is 404", async () => {
    await withRoutes(async ({ daemon, notebook, cell, rerun, send, changed }) => {
      const id = await cell('route("GET /old", () => "old")');
      await daemon.client.cell.update({ notebook, cell: id, source: "const nothing = 1" });
      await rerun(id);
      await changed((list) => list.length === 0);
      expect([(await send("/old")).status, (await send("/old")).body]).toEqual([
        404,
        "No route for GET /old",
      ]);
    });
  });
});

describe("a server cell that stops being one", () => {
  it("switched to markdown, then to client, loses its route at once: 404 and routes.changed without it", async () => {
    await withRoutes(async ({ daemon, notebook, cell, send, changed }) => {
      for (const type of ["markdown", "client"] as const) {
        const id = await cell('route("GET /gone", () => "here")');
        expect((await send("/gone")).body).toBe("here");
        await daemon.client.cell.update({ notebook, cell: id, type });
        await changed((list) => list.every((route) => route.cell !== id));
        expect((await send("/gone")).status).toBe(404);
      }
    });
  });
});

describe("an interrupt", () => {
  it("keeps the routes: the kernel's scope is intact", async () => {
    await withRoutes(async ({ daemon, notebook, cell, book, send, routes }) => {
      await cell('route("GET /ping", () => "pong")');
      const spin = await book.add("while (true) {}");
      const execution = await book.start(spin);
      await book.reaches(execution.id, "running");
      await daemon.client.kernel.interrupt({ notebook });
      await book.reaches(execution.id, "interrupted");
      expect((await routes()).map((route) => route.spec)).toEqual(["GET /ping"]);
      expect((await send("/ping")).body).toBe("pong");
    });
  });
});

describe("a kernel restart", () => {
  it("loses the routes: routes.changed with none, kernel.routes empty, 404 until the cell runs again", async () => {
    await withRoutes(async ({ daemon, notebook, cell, rerun, send, routes, changed, changes }) => {
      const id = await cell('route("GET /ping", () => "pong")');
      expect((await send("/ping")).body).toBe("pong");
      const before = daemon.events.all().length;
      await daemon.client.kernel.restart({ notebook });
      await daemon.events.until(
        "routes.changed",
        (e) => e.data.routes.length === 0 && daemon.events.all().indexOf(e) >= before,
      );
      expect(await routes()).toEqual([]);
      expect((await send("/ping")).status).toBe(404);
      const since = changes().length;
      await rerun(id);
      await changed((list) => list.length === 1, since);
      expect((await routes())[0]?.hits).toBe(0);
      expect((await send("/ping")).body).toBe("pong");
    });
  });
});

describe("a daemon restart", () => {
  it("loses the routes: the next daemon serves none until the cell runs again", async () => {
    await withWorkspace(async (ws) => {
      // startDaemon stops each daemon when the test ends, whatever fails first (tools/test/daemon.ts)
      const first = await startDaemon(ws);
      const book = await createNotebook(first, "hooks.jsnb");
      const { cell } = await book.ran('route("GET /ping", () => "pong")');
      expect((await rawHttp(first.server.port, { path: "/n/hooks/ping" })).body).toBe("pong");
      await first.stop();
      const second = await startDaemon(ws, { seed: 2 });
      await second.client.notebook.open({ path: book.notebook });
      expect((await second.client.kernel.routes({ notebook: book.notebook })).routes).toEqual([]);
      expect((await rawHttp(second.server.port, { path: "/n/hooks/ping" })).status).toBe(404);
      await second.client.cell.run({ notebook: book.notebook, cell });
      const answer = await rawHttp(second.server.port, { path: "/n/hooks/ping" });
      expect(answer.body).toBe("pong");
      await second.stop();
    });
  });
});
