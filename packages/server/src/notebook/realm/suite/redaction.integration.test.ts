// The bridge suite, 05-bridge §11 item 7 with 09-testing §4.3's bridge rows (real kernel, daemon and page): a secret in
// a call's result arrives as *** and the calling client cell gets the stderr warning; a secret in a snapshot, in what
// the server function logs of an argument, and in a thrown error's message is redacted too; no output carries it (the
// client cell's source does, as the user wrote it).
import { describe, expect, it } from "vitest";

import { bridgeSuite } from "../../../fixtures/bridge.js";
import { valueOf } from "../../../fixtures/notebook.js";

const { withBridge } = bridgeSuite();

const secret = "supersecret-stripe-4242";

const exports = `export function leak() { return { key: env.STRIPE_SECRET_KEY, note: "ok" } }
export const conf = { key: env.STRIPE_SECRET_KEY, mode: "test" }
export function shout(text: string) { console.log("got", text); return text.length }
export function boom() { throw new Error("bad key " + env.STRIPE_SECRET_KEY) }`;

describe("a secret crossing the bridge", () => {
  it("is *** in a result, with the warning on the calling cell, and in a snapshot", async () => {
    await withBridge(
      async ({ server, client, run }) => {
        await server(exports);
        const called = await run(await client("await leak()"));
        expect(valueOf(called)).toEqual({ key: "***", note: "ok" });
        expect(called.outputs).toContainEqual({
          kind: "stream",
          stream: "stderr",
          text: "redacted a secret in the result of leak\n",
        });
        expect(valueOf(await run(await client("conf")))).toEqual({ key: "***", mode: "test" });
        expect(JSON.stringify(called)).not.toContain(secret);
      },
      { files: { env: { STRIPE_SECRET_KEY: secret } } },
    );
  });

  it("is *** in what the server logs of an argument and in a thrown error's message", async () => {
    await withBridge(
      async ({ daemon, server, client, run }) => {
        const defining = await server(exports);
        expect(valueOf(await run(await client(`await shout("${secret}")`)))).toBe(secret.length);
        const logged = await daemon.events.until(
          "cell.output",
          (event) => event.data.cell === defining && event.data.output.kind === "stream",
        );
        expect(logged.data.output).toMatchObject({ text: "got ***\n" });
        const caught =
          'let message = ""\ntry { await boom() } catch (e) { message = (e as Error).message }\nmessage';
        expect(valueOf(await run(await client(caught)))).toBe("bad key ***");
        const outputs = daemon.events.all().filter((event) => event.type === "cell.output");
        expect(JSON.stringify(outputs)).not.toContain(secret);
      },
      { files: { env: { STRIPE_SECRET_KEY: secret } } },
    );
  });
});
