// Tests the Fetch side of routes: the Request a handler gets, the RouteResponse its result becomes.
import type { RouteRequest } from "@jsnb/core";
import { beforeAll, describe, expect, it } from "vitest";

import { RouteResultInvalid } from "./errors.js";
import { requestType, textResponse, toRequest, toRouteResponse } from "./request.js";

const base = "http://127.0.0.1:4321/n/demo";
const b64 = (text: string) => Buffer.from(text).toString("base64");
const forwarded = (fields: Partial<RouteRequest>): RouteRequest => ({
  method: "POST",
  path: "/hook",
  search: "",
  headers: {},
  rawBody: "",
  ...fields,
});

// Node loads its Fetch implementation on first use; that one-off cost is setup, not the behaviour under test.
beforeAll(async () => {
  await new Request("http://127.0.0.1/", { method: "POST", body: "warm" }).text();
  await new Response(new Uint8Array(1)).arrayBuffer();
});

describe("toRequest", () => {
  it("rebuilds the URL with the query as sent, the headers and the raw body bytes", async () => {
    const raw = '{ "type": "x",  "spaced": true }';
    const search = "?a=1&b=x+y&a=2&c=%20";
    const request = toRequest(
      base,
      forwarded({ search, headers: { "x-sig": "s" }, rawBody: b64(raw) }),
    );
    expect(request.url).toBe(`${base}/hook${search}`);
    expect(new URL(request.url).searchParams.getAll("a")).toEqual(["1", "2"]);
    expect(request.method).toBe("POST");
    expect(request.headers.get("x-sig")).toBe("s");
    expect(await request.text()).toBe(raw);
  });

  it("gives GET and HEAD no body", () => {
    expect(toRequest(base, forwarded({ method: "get", rawBody: b64("ignored") })).body).toBeNull();
  });
});

describe("toRouteResponse", () => {
  it("answers a string as 200 text, undefined as 204 and plain data as 200 JSON", async () => {
    expect(await toRouteResponse("hi", "GET /a")).toEqual(textResponse(200, "hi"));
    expect(await toRouteResponse(undefined, "GET /a")).toEqual({
      status: 204,
      headers: {},
      body: "",
    });
    expect(await toRouteResponse({ ok: true }, "GET /a")).toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      body: b64('{"ok":true}'),
    });
  });

  it("passes a Response through with its status, headers and body bytes", async () => {
    const bytes = new Uint8Array([0, 255, 1]);
    const response = new Response(bytes, { status: 401, headers: { "x-a": "1" } });
    expect(await toRouteResponse(response, "GET /a")).toEqual({
      status: 401,
      headers: { "x-a": "1" },
      body: Buffer.from(bytes).toString("base64"),
    });
  });

  it("keeps every Set-Cookie of a Response as a list", async () => {
    const headers = new Headers({ "x-a": "1" });
    headers.append("set-cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2");
    const answer = await toRouteResponse(new Response("x", { status: 201, headers }), "GET /a");
    expect(answer.headers).toEqual({
      "content-type": "text/plain;charset=UTF-8",
      "x-a": "1",
      "set-cookie": ["a=1; Path=/", "b=2"],
    });
  });
});

describe("toRouteResponse refusing a result", () => {
  it("refuses Response.error(), which carries no HTTP status", async () => {
    await expect(toRouteResponse(Response.error(), "GET /e")).rejects.toThrow(
      /returned Response\.error\(\), which carries no HTTP status/u,
    );
  });

  it("throws for a value JSON cannot write", async () => {
    await expect(toRouteResponse(() => 1, "GET /f")).rejects.toThrow(RouteResultInvalid);
    await expect(toRouteResponse({ n: 1n }, "GET /f")).rejects.toThrow(TypeError);
  });
});

describe("requestType", () => {
  it("reads the top-level string type of a JSON body and nothing else", () => {
    expect(requestType(forwarded({ rawBody: b64('{"type":"payment_intent.succeeded"}') }))).toBe(
      "payment_intent.succeeded",
    );
    for (const body of ['{"type":1}', "[1]", "{broken", "plain", ""]) {
      expect(requestType(forwarded({ rawBody: b64(body) }))).toBeUndefined();
    }
  });
});
