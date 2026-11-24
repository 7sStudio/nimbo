// Tests answering the daemon's requests to a page (03-api §7.2, 05-bridge §9): results, errors, validation.
import { JsnbError, RealmNotAttached } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { createRequestHandlers } from "./requests.js";

const execute = {
  execution: "x_a1b2c3d4",
  cell: "c_a1b2c3",
  code: "(async (__scope) => {})",
  map: "{}",
  bindings: {},
};

const answer = async (text: Promise<string>): Promise<unknown> => JSON.parse(await text) as unknown;

describe("createRequestHandlers", () => {
  it("answers with the handler's result, given validated params", async () => {
    const responders = createRequestHandlers();
    responders.register("realm.execute", (params) => ({ started: params.execution }));
    await expect(answer(responders.answer(1, "realm.execute", execute))).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { started: "x_a1b2c3d4" },
    });
  });

  it("answers a handler that returns nothing with a null result", async () => {
    const responders = createRequestHandlers();
    responders.register("realm.reset", () => undefined);
    await expect(answer(responders.answer("s", "realm.reset", {}))).resolves.toMatchObject({
      result: null,
    });
  });

  it("validates realm.interrupt's execution before its handler sees it", async () => {
    const responders = createRequestHandlers();
    const seen: string[] = [];
    responders.register("realm.interrupt", (params) => {
      seen.push(params.execution);
      return {};
    });
    await expect(
      answer(responders.answer(3, "realm.interrupt", { execution: "x_a1b2c3d4" })),
    ).resolves.toMatchObject({ result: {} });
    await expect(
      answer(responders.answer(4, "realm.interrupt", { execution: "x" })),
    ).resolves.toMatchObject({
      error: { code: -32602, data: { issues: [{ path: ["execution"] }] } },
    });
    expect(seen).toEqual(["x_a1b2c3d4"]);
  });
});

describe("createRequestHandlers on failures", () => {
  it("answers params that fail the schema with -32602 and the issues", async () => {
    const responders = createRequestHandlers();
    responders.register("realm.snapshot", () => ({}));
    const reply = await answer(responders.answer(2, "realm.snapshot", { cell: 7 }));
    expect(reply).toMatchObject({
      id: 2,
      error: { code: -32602, data: { issues: [{ path: ["cell"] }] } },
    });
  });

  it("answers an ApiError with its code and data, any other throw with -32603", async () => {
    const responders = createRequestHandlers();
    responders.register("realm.reset", () => {
      throw new RealmNotAttached({ notebook: "demo.jsnb" });
    });
    responders.register("realm.snapshot", () => Promise.reject(new Error("no container")));
    await expect(answer(responders.answer(3, "realm.reset", {}))).resolves.toMatchObject({
      error: { code: 1004, data: { notebook: "demo.jsnb" } },
    });
    await expect(
      answer(responders.answer(4, "realm.snapshot", { cell: "c_a1b2c3" })),
    ).resolves.toMatchObject({
      error: { code: -32603, message: "no container", data: { name: "Error" } },
    });
  });

  it("answers a result that is not JSON with -32603", async () => {
    const responders = createRequestHandlers();
    responders.register("realm.reset", () => ({ big: 1n }));
    await expect(answer(responders.answer(5, "realm.reset", {}))).resolves.toMatchObject({
      error: { code: -32603, data: { name: "TypeError" } },
    });
  });
});

describe("createRequestHandlers registration", () => {
  it("answers a method with no handler with -32601", async () => {
    const responders = createRequestHandlers();
    await expect(answer(responders.answer(6, "realm.unknown", {}))).resolves.toMatchObject({
      error: { code: -32601 },
    });
  });

  it("replaces a handler, and removes only the one it registered", async () => {
    const responders = createRequestHandlers();
    const removeFirst = responders.register("realm.reset", () => "first");
    responders.register("realm.reset", () => "second");
    removeFirst();
    await expect(answer(responders.answer(7, "realm.reset", {}))).resolves.toMatchObject({
      result: "second",
    });
    const removeSecond = responders.register("realm.reset", () => "third");
    removeSecond();
    await expect(answer(responders.answer(8, "realm.reset", {}))).resolves.toMatchObject({
      error: { code: -32601 },
    });
  });
});

describe("createRequestHandlers on errors that are not JSON", () => {
  it("still answers, with a plain -32603 and the error's name, when the error cannot be written", async () => {
    const responders = createRequestHandlers();
    responders.register("realm.reset", () => {
      throw new JsnbError({ name: "Oversized", message: "m", data: { bytes: 1n } });
    });
    responders.register("realm.snapshot", () => {
      throw Object.create(null);
    });
    await expect(answer(responders.answer(9, "realm.reset", {}))).resolves.toEqual({
      jsonrpc: "2.0",
      id: 9,
      error: {
        code: -32603,
        message: "The page's error could not be sent as JSON.",
        data: { name: "Oversized", unwritable: "TypeError" },
      },
    });
    await expect(
      answer(responders.answer(10, "realm.snapshot", { cell: "c_a1b2c3" })),
    ).resolves.toMatchObject({
      id: 10,
      error: { code: -32603, data: { name: "Error", unwritable: "TypeError" } },
    });
  });
});

describe("createRequestHandlers on errors whose name cannot be read", () => {
  it("still answers when even the error's name cannot be read", async () => {
    const responders = createRequestHandlers();
    const nasty = new RangeError("m");
    Object.defineProperty(nasty, "name", {
      get: () => {
        throw new SyntaxError("no name today");
      },
    });
    responders.register("realm.reset", () => {
      throw nasty;
    });
    await expect(answer(responders.answer(11, "realm.reset", {}))).resolves.toEqual({
      jsonrpc: "2.0",
      id: 11,
      error: {
        code: -32603,
        message: "The page's error could not be sent as JSON.",
        data: { name: "Error", unwritable: "SyntaxError" },
      },
    });
  });
});
