// The routes suite, end to end (a real kernel child and an in-process daemon): a handler's request (the
// raw body byte for byte, so a Stripe-style signature verifies; the parsed body; the query as sent, a repeated name
// kept) and its answer (an object as JSON 200, a string as text 200, undefined as 204, a real Response with its status,
// headers and every Set-Cookie, bytes unchanged), a spec's method in any case, and a HEAD that the GET route answers.
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { withRoutes } from "../../../fixtures/routes.js";

const secret = "whsec_test_4eC39HqLyjWDarjtT1zdp7dc";

/** A Stripe-style signature header over `body` at time `t`: `t=<t>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
const signed = (t: number, body: string, key = secret): string =>
  `t=${String(t)},v1=${createHmac("sha256", key)
    .update(`${String(t)}.${body}`)
    .digest("hex")}`;

const verifier = `import { createHmac, timingSafeEqual } from "node:crypto";
route("POST /webhook", async (req) => {
  const raw = await req.text();
  const header = req.headers.get("stripe-signature") ?? "";
  const [t, v1] = header.split(",").map((part) => part.split("=")[1] ?? "");
  const expected = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(t + "." + raw).digest("hex");
  const ok = v1.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
  if (!ok) return new Response("bad signature", { status: 400 });
  return { received: JSON.parse(raw).type };
});`;

describe("a webhook handler that verifies a signature over the raw body", () => {
  it("gets the body byte for byte: the right signature passes, a body changed by one byte does not", async () => {
    await withRoutes(
      async ({ cell, send }) => {
        await cell(verifier);
        const body = '{\r\n  "type":  "payment_intent.succeeded",\t"note": "café ☕ \\u00e9"\n}';
        const headers = { "content-type": "application/json", "stripe-signature": signed(1, body) };
        const ok = await send("/webhook", { method: "POST", headers, body });
        expect([ok.status, JSON.parse(ok.body)]).toEqual([
          200,
          { received: "payment_intent.succeeded" },
        ]);
        expect(ok.headers["content-type"]).toBe("application/json");
        const tampered = await send("/webhook", { method: "POST", headers, body: `${body} ` });
        expect([tampered.status, tampered.body]).toEqual([400, "bad signature"]);
        const forged = { ...headers, "stripe-signature": signed(1, body, "whsec_other") };
        expect((await send("/webhook", { method: "POST", headers: forged, body })).status).toBe(
          400,
        );
      },
      { files: { env: { STRIPE_WEBHOOK_SECRET: secret } } },
    );
  });

  it("gets bytes that are no UTF-8 unchanged through req.arrayBuffer()", async () => {
    await withRoutes(async ({ cell, send }) => {
      await cell(
        'route("PUT /bytes", async (req) => [...new Uint8Array(await req.arrayBuffer())])',
      );
      const bytes = new Uint8Array([0, 255, 13, 10, 128, 0xc3]);
      const answer = await send("/bytes", { method: "PUT", body: bytes });
      expect(JSON.parse(answer.body)).toEqual([...bytes]);
    });
  });
});

describe("a handler's request", () => {
  it("has req.json(), the query as sent with a repeated name, the method and the headers", async () => {
    await withRoutes(async ({ cell, send }) => {
      await cell(`route("patch /echo", async (req) => {
  const url = new URL(req.url);
  return { method: req.method, body: await req.json(), a: url.searchParams.getAll("a"), search: url.search, sig: req.headers.get("x-sig") };
})`);
      const answer = await send("/echo?a=1&b=x+y&&a=2", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-sig": "s1" },
        body: '{"n": [1, 2]}',
      });
      expect(JSON.parse(answer.body)).toEqual({
        method: "PATCH",
        body: { n: [1, 2] },
        a: ["1", "2"],
        search: "?a=1&b=x+y&&a=2",
        sig: "s1",
      });
    });
  });
});

describe("a handler's answer", () => {
  it("is JSON 200 for data, text 200 for a string, 204 for undefined", async () => {
    await withRoutes(async ({ cell, send }) => {
      await cell(`route("GET /data", () => ({ ok: true, n: null }))
route("GET /text", () => "pong")
route("GET /none", () => {})
route("GET /null", () => null)`);
      const data = await send("/data");
      expect([data.status, data.headers["content-type"], data.body]).toEqual([
        200,
        "application/json",
        '{"ok":true,"n":null}',
      ]);
      const text = await send("/text");
      expect([text.status, text.headers["content-type"], text.body]).toEqual([
        200,
        "text/plain; charset=utf-8",
        "pong",
      ]);
      const none = await send("/none");
      expect([none.status, none.body, none.headers["content-length"]]).toEqual([
        204,
        "",
        undefined,
      ]);
      expect([(await send("/null")).status, (await send("/null")).body]).toEqual([200, "null"]);
    });
  });
});

describe("a handler's Response", () => {
  it("passes a real Response through: its status, headers, every Set-Cookie and its bytes", async () => {
    await withRoutes(async ({ cell, send }) => {
      await cell(`route("POST /made", () => {
  const headers = new Headers({ "x-request-id": "r1", "content-type": "application/octet-stream" });
  headers.append("set-cookie", "a=1; Path=/; HttpOnly");
  headers.append("set-cookie", "b=2");
  return new Response(new Uint8Array([0, 255, 1]), { status: 201, statusText: "Made", headers });
})`);
      const answer = await send("/made", { method: "POST" });
      expect(answer.status).toBe(201);
      expect(answer.headers["x-request-id"]).toBe("r1");
      expect(answer.headers["content-type"]).toBe("application/octet-stream");
      expect(answer.headers["set-cookie"]).toEqual(["a=1; Path=/; HttpOnly", "b=2"]);
      expect([...answer.bytes]).toEqual([0, 255, 1]);
      expect(answer.headers["content-length"]).toBe("3");
    });
  });

  it("answers a HEAD through the GET route, headers only, unless a HEAD route is registered", async () => {
    await withRoutes(async ({ cell, send }) => {
      await cell('route("GET /page", () => "a body")');
      const head = await send("/page", { method: "HEAD" });
      expect([head.status, head.body, head.headers["content-length"]]).toEqual([200, "", "6"]);
      await cell(
        'route("HEAD /page", () => new Response(null, { headers: { "x-own": "1", "content-length": "6" } }))',
      );
      const own = await send("/page", { method: "HEAD" });
      expect([own.headers["x-own"], own.headers["content-length"]]).toEqual(["1", "6"]);
      expect((await send("/page")).body).toBe("a body");
    });
  });
});
