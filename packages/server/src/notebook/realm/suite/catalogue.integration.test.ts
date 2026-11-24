// The bridge suite, 05-bridge §11 items 3 and 4 with the error catalogue of §7, word for word (real kernel, daemon and
// page): a class instance, a class and a nested instance are NotTransferable when read, a name defined unexported is
// NotExported before anything runs, a DOM node argument is ArgumentNotSerializable before anything is sent, a class
// instance result is ResultNotSerializable, bytes over bridge.maxBytesPerValue say so by their own class with the page
// and the kernel both applying the setting; a server value is NotExported under a name of window too, while a server
// cell's import and the page's built-ins stay the page's; a server cell that reads a name only a client cell defines
// ends DefinedInClient where it reads it, never on a name the kernel has.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Execution } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { bridgeSuite } from "../../../fixtures/bridge.js";
import { valueOf } from "../../../fixtures/notebook.js";

const { withBridge } = bridgeSuite();

const messageOf = (execution: Execution): string | undefined => execution.error?.message;

describe("an export that is not plain data", () => {
  it("is NotTransferable when the client cell reads it, naming the value's path, and only then", async () => {
    await withBridge(async ({ server, client, run }) => {
      await server(
        'class Stripe { key = "k" }\nexport const stripe = new Stripe()\nexport class Shape {}\nexport const config = { client: new Stripe(), name: "demo" }',
      );
      expect(messageOf(await run(await client("stripe")))).toBe(
        "stripe is a Stripe instance on the server and cannot be copied to the browser. Export a function that uses it instead.",
      );
      expect(messageOf(await run(await client("Shape")))).toBe(
        "Shape is a class on the server and cannot be copied to the browser. Export a function that uses it instead.",
      );
      expect(messageOf(await run(await client("config.name")))).toBe(
        "config.client is a Stripe instance on the server and cannot be copied to the browser. Export a function that uses it instead.",
      );
      expect(valueOf(await run(await client("const never = false\nnever ? stripe : 1")))).toBe(1);
    });
  });
});

describe("a server name that is not exported", () => {
  it("is NotExported before the client cell runs anything", async () => {
    await withBridge(async ({ server, client, run }) => {
      await server("const secretPrice = 7");
      const execution = await run(await client('console.log("ran")\nsecretPrice * 2'));
      expect(execution).toMatchObject({ status: "error", outputs: [] });
      expect(messageOf(execution)).toBe(
        "secretPrice is defined in server cell 1 but not exported. Add export in that cell to use it here.",
      );
    });
  });

  it("is NotExported even under a name of window: a server value never turns into the browser's", async () => {
    await withBridge(async ({ server, client, run }) => {
      await server(
        'const status = "paid"\nconst name = "Ada"\nfunction find(q: string) { return q }\nconst origin = "server"',
      );
      expect(messageOf(await run(await client("[status, name, origin]")))).toBe(
        "status is defined in server cell 1 but not exported. Add export in that cell to use it here.",
      );
      expect((await run(await client('find("x")'))).error).toMatchObject({
        name: "NotExported",
        data: { name: "find", index: 1 },
      });
    });
  });

  it("leaves a server cell's imports and the page's own built-ins to the page: crypto, document", async () => {
    await withBridge(async ({ server, client, run }) => {
      await server(
        'import crypto from "node:crypto"\nconst document = "server"\nexport const id = crypto.randomUUID()',
      );
      const execution = await run(
        await client("[crypto.randomUUID().length, typeof document.title, id.length]"),
      );
      expect(execution.status).toBe("ok");
      expect(valueOf(execution)).toEqual([36, "string", 36]);
    });
  });
});

describe("a server export whose cell has not run", () => {
  it("is ExportNotRun, saying which cell to run, even under a name of window", async () => {
    await withBridge(async ({ daemon, notebook, book, client, run }) => {
      const status = await book.add('export const status = "paid"');
      const message =
        "status is exported by server cell 1, but the kernel does not have that export yet. Run server cell 1 to make it.";
      expect(messageOf(await run(await client("status")))).toBe(message);
      // the cell ran before its export was written (NotExported's own advice leads here): the same reason holds
      await daemon.client.cell.update({ notebook, cell: status, source: 'const status = "paid"' });
      await run(status);
      await daemon.client.cell.update({
        notebook,
        cell: status,
        source: 'export const status = "paid"',
      });
      expect(messageOf(await run(await client("status")))).toBe(message);
    });
  });
});

describe("a value a call cannot carry", () => {
  it("is ArgumentNotSerializable before the call is sent, and ResultNotSerializable for a class instance", async () => {
    await withBridge(async ({ daemon, notebook, server, client, run }) => {
      const take = await server(
        'export function take(a: number, b: unknown) { console.log("called"); return a }\nclass Client {}\nexport function make() { return new Client() }',
      );
      const argument = await run(await client('await take(1, document.createElement("div"))'));
      expect(messageOf(argument)).toBe(
        "Argument 2 of take(...) is an HTMLDivElement and cannot be sent to the server.",
      );
      expect(messageOf(await run(await client("await make()")))).toBe(
        "make returned a Client instance, which cannot be sent to the browser. Return plain data.",
      );
      const { execution } = await daemon.client.cell.outputs({ notebook, cell: take });
      expect(execution?.outputs).toEqual([]);
    });
  });
});

describe("bytes over bridge.maxBytesPerValue", () => {
  it("are refused for their size, with the limit, by the page and by the kernel alike", async () => {
    await withBridge(async ({ daemon, notebook, server, client, run }) => {
      await daemon.client.settings.set({ key: "bridge.maxBytesPerValue", value: 1024 });
      await daemon.client.kernel.restart({ notebook });
      await server(
        "export function size(b: Uint8Array) { return b.length }\nexport function big() { return new Uint8Array(2048) }\nexport const logo = Buffer.alloc(2048)",
      );
      expect(valueOf(await run(await client("await size(new Uint8Array(1024))")))).toBe(1024);
      expect(messageOf(await run(await client("await size(new Uint8Array(1025))")))).toBe(
        "Argument 1 of size(...) is a Uint8Array of 1025 bytes, more than bridge.maxBytesPerValue (1024 bytes) lets cross. Raise the setting, or send it in parts.",
      );
      expect(messageOf(await run(await client("await big()")))).toBe(
        "big returned a Uint8Array of 2048 bytes, more than bridge.maxBytesPerValue (1024 bytes) lets cross. Raise the setting, or return part of it.",
      );
      expect(messageOf(await run(await client("logo.length")))).toBe(
        "logo is a Buffer of 2048 bytes, more than bridge.maxBytesPerValue (1024 bytes) lets cross. Raise the setting, or export a function that returns part of it.",
      );
      // the advice holds at once: raised, the kernel's side follows on the next snapshot and call, no restart
      await daemon.client.settings.set({ key: "bridge.maxBytesPerValue", value: 4096 });
      expect(valueOf(await run(await client("logo.length")))).toBe(2048);
      expect(valueOf(await run(await client("(await big()).length")))).toBe(2048);
    });
  });
});

describe("a client name a server cell uses", () => {
  it("is DefinedInClient where the server cell reads it, and runs in the page once switched", async () => {
    await withBridge(async ({ daemon, notebook, book, client, run }) => {
      const page = await client(
        "const format = (n: number) => `#${String(n)}`\nconst URL = 1\nconst display = 2",
      );
      expect((await run(page)).status).toBe("ok");
      const cell = await book.add('console.log("ran")\nformat(1)');
      const execution = await run(cell);
      // the kernel's ReferenceError decides: what ran before the read has run, and Jump goes to the read
      expect(execution.status).toBe("error");
      expect(execution.outputs).toMatchObject([{ kind: "stream", text: "ran\n" }]);
      expect(execution.error).toMatchObject({
        name: "DefinedInClient",
        message:
          "format is defined in client cell 1; server cells can't call into the page. Switch this cell to client, or move format to a server cell and export it.",
        data: { name: "format", index: 1 },
        frames: [{ cell, line: 2 }],
      });
      expect(execution.error?.raw.startsWith("DefinedInClient: format is defined")).toBe(true);
      expect((await run(await book.add("[typeof URL, typeof display]"))).status).toBe("ok");
      await daemon.client.cell.update({ notebook, cell, type: "client" });
      expect(valueOf(await run(cell))).toBe("#1");
    });
  });

  it("never fails a guard, a name the kernel holds, a function never called, or a server cell's own", async () => {
    await withBridge(async ({ server, client, run }) => {
      await client("const fmt = () => 'page'\nconst shared = 1\nconst later = 2\nconst format = 3");
      expect(valueOf(await run(await server("typeof fmt === 'function' ? 'page' : 'none'")))).toBe(
        "none",
      );
      await server("(globalThis as { shared?: number }).shared = 7");
      expect(valueOf(await run(await server("shared")))).toBe(7);
      expect((await run(await server("function never() { return later }\n1"))).status).toBe("ok");
      await server("const format = () => 'server'");
      expect(valueOf(await run(await server("format()")))).toBe("server");
    });
  });
});

describe("a client name read elsewhere than the server cell that ran", () => {
  it("stays the ReferenceError, whose Jump goes to the read: a package's and another cell's", async () => {
    await withBridge(async ({ workspace, server, client, run, book }) => {
      const lib = workspace.path("node_modules", "libx");
      await mkdir(lib, { recursive: true });
      await writeFile(
        join(lib, "package.json"),
        '{ "name": "libx", "type": "module", "main": "index.js" }',
      );
      await writeFile(
        join(lib, "index.js"),
        "export const render = () => globalThis.$ === undefined ? $ : 1;\n",
      );
      expect((await run(await client("const $ = 1\nconst fmt = () => 2"))).status).toBe("ok");
      const fromPackage = await run(await book.add('import { render } from "libx";\nrender()'));
      expect(fromPackage.error).toMatchObject({
        name: "ReferenceError",
        message: "$ is not defined",
      });
      const other = await server("export function useFmt() { return fmt() }");
      const fromOther = await run(await book.add("useFmt()"));
      expect(fromOther.error).toMatchObject({
        name: "ReferenceError",
        message: "fmt is not defined",
      });
      expect(fromOther.error?.frames[0]?.cell).toBe(other);
    });
  });
});
