// The token and the secrets on the routes' surface (09-testing §5 rows Token, Routes and Secrets; 03-api §7.1; 04-kernel
// §10): wherever a request below /n/ carries the daemon's token or page key (a cookie, Authorization, a Referer from a
// page that still had `?token=`, any header, a query parameter, as sent or escaped), no handler sees it, so it never
// reaches an answer or an output; the request's other cookies, headers and parameters pass. What a handler logs,
// throws or receives as an event's type is redacted in its outputs and in the daemon's 500.
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { pageCookie } from "../../../fixtures/raw.js";
import type { RoutesWorld } from "../../../fixtures/routes.js";
import { withRoutes } from "../../../fixtures/routes.js";

/** What the echo handler answers: its request's URL and headers. */
const Seen = z.object({ url: z.string(), headers: z.array(z.tuple([z.string(), z.string()])) });

const echo = `route("GET /echo", (req) => {
  const seen = { url: req.url, headers: [...req.headers.entries()] };
  console.log(JSON.stringify(seen));
  return seen;
})`;

/** The echo route's request with the token and the page key in every place a request can carry them. */
async function sendCredentials(world: RoutesWorld) {
  const { port, token } = world.daemon.server;
  const page = await pageCookie(port, token);
  const escaped = encodeURIComponent(`${token}+`);
  const answer = await world.send(
    `/echo?token=${token}&keep=2&wrapped=a${escaped}&t=${token.slice(0, 8)}`,
    {
      headers: {
        cookie: `${page}; nimbo-1=other; named=${token}; esc=${escaped}; keep=1`,
        authorization: `Bearer ${token}`,
        referer: `http://127.0.0.1:${String(port)}/ui/hooks?token=${token}`,
        "x-forwarded": `prefix ${token} suffix`,
        "x-kept": "yes",
      },
    },
  );
  return { answer, token, pageKey: page.split("=")[1] ?? "" };
}

describe("the daemon's credentials on a route request", () => {
  it("never reach the handler, its answer or its outputs; everything else of the request does", async () => {
    await withRoutes(async (world) => {
      const { daemon, notebook, cell, eventsOn } = world;
      const id = await cell(echo);
      const { answer, token, pageKey } = await sendCredentials(world);
      expect(answer.status).toBe(200);
      const seen = Seen.parse(JSON.parse(answer.body));
      const headers = Object.fromEntries(seen.headers);
      expect(new URL(seen.url).search).toBe(`?keep=2&t=${token.slice(0, 8)}`);
      expect([headers.cookie, headers["x-kept"]]).toEqual(["keep=1", "yes"]);
      for (const name of ["authorization", "referer", "x-forwarded"])
        expect(headers[name]).toBeUndefined();
      await eventsOn(id, 1);
      const { execution } = await daemon.client.cell.outputs({ notebook, cell: id });
      const outputs = JSON.stringify(execution?.outputs);
      expect(outputs).toContain("x-kept");
      const everything = JSON.stringify(daemon.events.all());
      for (const secret of [token, pageKey]) {
        expect([answer.body.includes(secret), outputs.includes(secret)]).toEqual([false, false]);
        expect(everything).not.toContain(secret);
      }
    });
  });

  it("are never in the daemon's own answers below /n/, nor in a route's URL", async () => {
    await withRoutes(async ({ daemon, book, send }) => {
      const { token } = daemon.server;
      const { execution } = await book.ran(
        'route("GET /boom", () => { throw new Error("x") })\nrouteUrl("/boom")',
      );
      expect(JSON.stringify(execution)).not.toContain(token);
      for (const path of [`/nope?token=${token}`, `/boom?token=${token}`]) {
        const answer = await send(path, { headers: { authorization: `Bearer ${token}` } });
        expect(JSON.stringify([answer.headers, answer.body])).not.toContain(token);
      }
    });
  });
});

/** The `.env` of the redaction test; the Stripe key is built from parts so the repository holds no key-shaped string. */
const secrets = {
  STRIPE_SECRET_KEY: ["sk", "test", "51abcdefghijk"].join("_"),
  MY_SECRET: "hunter2-very-secret",
};

const leaky = `route("POST /hook", async (req) => {
  console.log("keys", env.STRIPE_SECRET_KEY, env.MY_SECRET);
  const body = await req.json();
  if (body.fail) throw new Error("failed with " + env.MY_SECRET);
  return { ok: true };
})`;

describe("a route's outputs", () => {
  it("are redacted: what the handler logs, what it throws, the type it receives; the 500 too", async () => {
    await withRoutes(
      async ({ daemon, notebook, cell, send, eventsOn }) => {
        const id = await cell(leaky);
        // the sender a User-Agent names is redacted as the type is
        const headers = { "user-agent": "hunter2-very-secret/1.0" };
        const post = (body: string) => send("/hook", { method: "POST", body, headers });
        expect((await post('{"type":"hunter2-very-secret"}')).status).toBe(200);
        const failed = await post('{"type":"sk_test_51Hzzz","fail":true}');
        expect([failed.status, failed.body]).toEqual([500, "Error: failed with ***"]);
        const events = await eventsOn(id, 2);
        const took = expect.any(Number) as unknown;
        expect(events.map((event) => event.data)).toEqual([
          { status: 200, type: "***", durationMs: took, from: "***" },
          { status: 500, type: "***", durationMs: took, from: "***" },
        ]);
        const { execution } = await daemon.client.cell.outputs({ notebook, cell: id });
        const outputs = execution?.outputs ?? [];
        const texts = outputs.flatMap((output) => (output.kind === "stream" ? [output.text] : []));
        const messages = outputs.flatMap((output) =>
          output.kind === "error" ? [output.error.message] : [],
        );
        expect([texts, messages]).toEqual([
          ["keys *** ***\n", "keys *** ***\n"],
          ["failed with ***"],
        ]);
        const everything = JSON.stringify(daemon.events.all());
        for (const secret of [...Object.values(secrets), "sk_test_51Hzzz"])
          expect(everything).not.toContain(secret);
      },
      { files: { env: secrets } },
    );
  });
});
