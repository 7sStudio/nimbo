// bridge.call through the daemon: only a current export runs, its result relayed with
// the kernel's redaction flag; a throw, a name that is no current export (NotExported, NoSuchExport, KernelRestarted
// after a restart) and a call past bridge.rpcTimeoutMs are BRIDGE_CALL_FAILED with the ErrorInfo. And the realm
// protocol's refusals: realm.attach over HTTP, a report from no attached page, the detach of a page already gone.
import { bridgeCall, realmAttach, realmDetach, realmReport } from "@jsnb/core";
import type { Daemon } from "../../fixtures/daemon.js";
import { withDaemon } from "../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { createNotebook } from "../../fixtures/notebook.js";

const exports = [
  "export function add(a: number, b: number) { return a + b }",
  "export function leak() { return env.SECRET_KEY }",
  'export function boom() { throw new Error("nope") }',
  "export function never() { return new Promise(() => {}) }",
  "const hidden = () => 1",
].join("\n");

/** A notebook whose first cell defines `exports`, and bridge.call on it. */
async function withExports(daemon: Daemon) {
  const book = await createNotebook(daemon);
  const server = (await book.ran(exports)).cell;
  const call = (fn: string, args: unknown[] = []) =>
    daemon.client.call(bridgeCall, { notebook: book.notebook, fn, args });
  return { book, server, call };
}

describe("bridge.call of a current export", () => {
  it("relays the result, and the kernel's redaction of a secret in it", async () => {
    await withDaemon(
      async (daemon) => {
        const { call } = await withExports(daemon);
        expect(await call("add", [2, 3])).toEqual({ result: 5 });
        expect(await call("leak")).toEqual({ result: "***", redacted: true });
      },
      { files: { env: { SECRET_KEY: "supersecret99" } } },
    );
  });
});

describe("bridge.call's failures", () => {
  it("are BRIDGE_CALL_FAILED: a throw, a name that is no export, a call past bridge.rpcTimeoutMs", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.settings.set({ key: "bridge.rpcTimeoutMs", value: 100 });
      const { server, call } = await withExports(daemon);
      const failure = (name: string, data: object = {}) => ({
        code: 2001,
        data: { error: { name, ...data } },
      });
      await expect(call("boom")).rejects.toMatchObject(failure("Error", { message: "nope" }));
      await expect(call("hidden")).rejects.toMatchObject(
        failure("NotExported", { data: { cell: server, index: 1 } }),
      );
      await expect(call("nothing")).rejects.toMatchObject(failure("NoSuchExport"));
      await expect(call("never", [])).rejects.toMatchObject(failure("RpcTimeout"));
    });
  });

  it("is KernelRestarted for an export the kernel had before it restarted, until its cell runs again", async () => {
    await withDaemon(async (daemon) => {
      const { book, server, call } = await withExports(daemon);
      await daemon.client.kernel.restart({ notebook: book.notebook });
      await expect(call("add", [1, 1])).rejects.toMatchObject({
        code: 2001,
        data: { error: { name: "KernelRestarted", data: { name: "add", cell: server, index: 1 } } },
      });
      await daemon.client.cell.run({ notebook: book.notebook, cell: server });
      expect(await call("add", [1, 1])).toEqual({ result: 2 });
    });
  });
});

describe("the realm protocol's refusals", () => {
  it("refuses realm.attach over HTTP and a report from no attached page (INVALID_PARAMS on realmId); a gone page's detach does nothing", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      await expect(
        daemon.http().call(realmAttach, { notebook: book.notebook, kind: "tab" }),
      ).rejects.toMatchObject({ code: -32601 });
      const page = daemon.socket({ client: "ui" });
      const { realmId } = await page.call(realmAttach, { notebook: book.notebook, kind: "tab" });
      expect(await page.call(realmDetach, { realmId })).toEqual({});
      for (const id of [realmId, "realm_gone"]) {
        const report = { realmId: id, execution: "x_00000000", status: "ok" as const };
        await expect(page.call(realmReport, report)).rejects.toMatchObject({
          code: -32602,
          data: { issues: [{ path: ["realmId"] }] },
        });
      }
      expect(await daemon.client.call(realmDetach, { realmId: "realm_gone" })).toEqual({});
    });
  });
});
