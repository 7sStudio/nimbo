// 02-architecture §5's interrupt paragraph for a client cell (03-api §4.4; real kernel, daemon and page): kernel.interrupt
// ends a client cell that awaits as `interrupted` with its scope intact and answers that cell, and the queue goes on; it
// also stops the server function such a cell awaits; and a page frozen in a loop of its own cannot stop the daemon from
// ending the run and running the next cell; a run interrupted while it waits for the kernel's snapshot never starts.
import { describe, expect, it } from "vitest";

import { bridgeSuite } from "../../../fixtures/bridge.js";
import { valueOf } from "../../../fixtures/notebook.js";

const { withBridge } = bridgeSuite();

describe("kernel.interrupt while a client cell awaits", () => {
  it("ends it interrupted with its scope intact, answers that cell, and the queue goes on", async () => {
    await withBridge(async ({ daemon, notebook, book, client, run }) => {
      const waiting = await client('const before = "defined"\nawait new Promise(() => {})');
      const started = await book.start(waiting);
      await book.reaches(started.id, "running");
      const after = await book.add("1 + 1");
      const queued = await book.start(after);
      expect(await daemon.client.kernel.interrupt({ notebook })).toEqual({ interrupted: waiting });
      await book.reaches(started.id, "interrupted");
      await book.reaches(queued.id, "interrupted");
      const { execution: ended } = await daemon.client.cell.outputs({ notebook, cell: waiting });
      expect(ended?.durationMs).toBeGreaterThan(0);
      expect(valueOf(await run(after))).toBe(2);
      expect(valueOf(await run(await client("before")))).toBe("defined");
    });
  });

  it("stops the server function it awaits, and the kernel answers the next call", async () => {
    await withBridge(async ({ daemon, notebook, book, server, client, run }) => {
      await server(
        'import { writeSync } from "node:fs"\nexport function spin() { writeSync(1, "spinning\\n"); while (true) {} }\nexport const ok = () => "ok"',
      );
      const waiting = await client("await spin()");
      const started = await book.start(waiting);
      await expect
        .poll(async () => (await daemon.client.kernel.log({ notebook })).lines.join("\n"))
        .toContain("spinning");
      expect(await daemon.client.kernel.interrupt({ notebook })).toEqual({ interrupted: waiting });
      await book.reaches(started.id, "interrupted");
      expect(valueOf(await run(await client("await ok()")))).toBe("ok");
    });
  });
});

describe("kernel.interrupt while the page is frozen in a client cell's own loop", () => {
  it("ends the run interrupted without the page, and the next cell runs", async () => {
    await withBridge(async ({ daemon, notebook, book, run }) => {
      const frozen = await book.add("while (true) {}", "client");
      const started = await book.start(frozen);
      await book.reaches(started.id, "running");
      expect(await daemon.client.kernel.interrupt({ notebook })).toEqual({ interrupted: frozen });
      await book.reaches(started.id, "interrupted");
      expect(valueOf(await run(await book.add("2 + 2")))).toBe(4);
    });
  });
});

describe("kernel.interrupt while a client run waits for its snapshot", () => {
  it("ends it interrupted for good: the page never runs it and no later running status comes", async () => {
    await withBridge(async ({ daemon, notebook, book, page, server, client, run }) => {
      await server(
        'import { writeSync } from "node:fs"\nexport function spin() { writeSync(1, "spinning\\n"); while (true) {} }\nexport const ok = 1',
      );
      const armed = await client(
        'const box = display.div()\nbox.addEventListener("go", () => { void spin() })\n"armed"',
      );
      expect(valueOf(await run(armed))).toBe("armed");
      await page.dispatch(armed, "go");
      await expect
        .poll(async () => (await daemon.client.kernel.log({ notebook })).lines.join("\n"))
        .toContain("spinning");
      const waiting = await client('console.log("ran", ok)');
      const started = await book.start(waiting);
      expect(await daemon.client.kernel.interrupt({ notebook })).toEqual({ interrupted: waiting });
      await book.reaches(started.id, "interrupted");
      expect(valueOf(await run(await client("await (async () => ok)()")))).toBe(1);
      const statuses = daemon.events
        .all()
        .flatMap((event) =>
          event.type === "cell.status" && event.data.execution === started.id
            ? [event.data.status]
            : [],
        );
      expect(statuses).toEqual(["queued", "interrupted"]);
      const ran = daemon.events
        .all()
        .some((event) => event.type === "cell.output" && event.data.execution === started.id);
      expect(ran).toBe(false);
    });
  });
});

describe("kernel.interrupt of a client cell that used its container", () => {
  it("keeps the container in the cell: the run ends with its dom output", async () => {
    await withBridge(async ({ daemon, notebook, book, client }) => {
      const waiting = await client(
        'const box = display.div()\nbox.textContent = "Pay"\nawait new Promise(() => {})',
      );
      const started = await book.start(waiting);
      await book.reaches(started.id, "running");
      await daemon.client.kernel.interrupt({ notebook });
      await book.reaches(started.id, "interrupted");
      await daemon.events.until(
        "cell.output",
        (event) => event.data.execution === started.id && event.data.output.kind === "dom",
      );
      const { execution } = await daemon.client.cell.outputs({ notebook, cell: waiting });
      expect(execution?.outputs).toContainEqual(
        expect.objectContaining({ kind: "dom", text: "Pay" }),
      );
    });
  });
});

describe("a kernel restart while a client run waits for its snapshot", () => {
  it("ends the run interrupted, never KernelDead, and never running", async () => {
    await withBridge(async ({ daemon, notebook, workspace, book, page, server, client, run }) => {
      const flag = JSON.stringify(workspace.path("never-let-go"));
      await server(
        `import { existsSync, writeSync } from "node:fs"\nexport function hold() { writeSync(1, "held\\n"); while (!existsSync(${flag})) {} }\nexport const ok = 1`,
      );
      const armed = await client(
        'const box = display.div()\nbox.addEventListener("go", () => { void hold() })\n"armed"',
      );
      expect(valueOf(await run(armed))).toBe("armed");
      await page.dispatch(armed, "go");
      await expect
        .poll(async () => (await daemon.client.kernel.log({ notebook })).lines.join("\n"))
        .toContain("held");
      const started = await book.start(await client("ok"));
      await daemon.client.kernel.restart({ notebook });
      await book.reaches(started.id, "interrupted");
      const statuses = daemon.events
        .all()
        .flatMap((event) =>
          event.type === "cell.status" && event.data.execution === started.id
            ? [event.data.status]
            : [],
        );
      expect(statuses).toEqual(["queued", "interrupted"]);
    });
  });
});
