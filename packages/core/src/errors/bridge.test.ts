// Tests the bridge error messages of 05-bridge §7 against the catalogue, word for word.
import { describe, expect, it } from "vitest";

import {
  ArgumentNotSerializable,
  DefinedInClient,
  ExportNotRun,
  KernelRestarted,
  NotExported,
  NotTransferable,
  ResultNotSerializable,
  RpcTimeout,
} from "./bridge.js";

describe("the bridge errors", () => {
  it("print the catalogue messages", () => {
    expect(new NotExported({ name: "createIntent", cell: "c_d4e5f6", index: 2 }).message).toBe(
      "createIntent is defined in server cell 2 but not exported. Add export in that cell to use it here.",
    );
    expect(new NotTransferable({ name: "stripe", type: "Stripe" }).message).toBe(
      "stripe is a Stripe instance on the server and cannot be copied to the browser. Export a function that uses it instead.",
    );
    expect(
      new ArgumentNotSerializable({ name: "createIntent", argIndex: 1, type: "HTMLDivElement" })
        .message,
    ).toBe(
      "Argument 2 of createIntent(...) is an HTMLDivElement and cannot be sent to the server.",
    );
    expect(new ResultNotSerializable({ name: "createIntent", type: "Stripe" }).message).toBe(
      "createIntent returned a Stripe instance, which cannot be sent to the browser. Return plain data.",
    );
    expect(new RpcTimeout({ name: "createIntent", args: [2000], timeoutMs: 60_000 }).message).toBe(
      "createIntent(2000) did not answer within 60s. The server cell may be blocked; try kernel.interrupt.",
    );
    expect(new KernelRestarted({ name: "createIntent", cell: "c_d4e5f6", index: 2 }).message).toBe(
      "createIntent was defined before the kernel restarted. Re-run server cell 2.",
    );
    const inClient = new DefinedInClient({ name: "format", cell: "c_d4e5f6", index: 4 });
    expect([inClient.name, inClient.message, inClient.data]).toEqual([
      "DefinedInClient",
      "format is defined in client cell 4; server cells can't call into the page. Switch this cell to client, or move format to a server cell and export it.",
      { name: "format", cell: "c_d4e5f6", index: 4 },
    ]);
  });
});

describe("the bridge errors beyond the catalogue's templates", () => {
  it("name an exported class, bytes over the limit, and a name only the kernel still holds", () => {
    expect(new NotTransferable({ name: "Shape", type: "class" }).message).toBe(
      "Shape is a class on the server and cannot be copied to the browser. Export a function that uses it instead.",
    );
    expect(
      new NotTransferable({ name: "logo", type: "Buffer", bytes: 2048, limit: 1024 }).message,
    ).toBe(
      "logo is a Buffer of 2048 bytes, more than bridge.maxBytesPerValue (1024 bytes) lets cross. Raise the setting, or export a function that returns part of it.",
    );
    expect(
      new ArgumentNotSerializable({
        name: "upload",
        argIndex: 0,
        type: "Uint8Array",
        bytes: 9,
        limit: 8,
      }).message,
    ).toBe(
      "Argument 1 of upload(...) is a Uint8Array of 9 bytes, more than bridge.maxBytesPerValue (8 bytes) lets cross. Raise the setting, or send it in parts.",
    );
    expect(
      new ResultNotSerializable({ name: "image", type: "Uint8Array", bytes: 9, limit: 8 }).message,
    ).toBe(
      "image returned a Uint8Array of 9 bytes, more than bridge.maxBytesPerValue (8 bytes) lets cross. Raise the setting, or return part of it.",
    );
    expect(new ExportNotRun({ name: "prices", cell: "c_d4e5f6", index: 2 }).message).toBe(
      "prices is exported by server cell 2, but the kernel does not have that export yet. Run server cell 2 to make it.",
    );
    expect(new NotExported({ name: "createIntent" }).message).toBe(
      "createIntent is no longer exported by any server cell. Export it from a server cell to use it here.",
    );
  });
});

describe("the article before a type", () => {
  it("follows the first sound in an instance's message too: an OpenAI, an EventEmitter, a Stripe", () => {
    expect(new NotTransferable({ name: "client", type: "OpenAI" }).message).toBe(
      "client is an OpenAI instance on the server and cannot be copied to the browser. Export a function that uses it instead.",
    );
    expect(new ResultNotSerializable({ name: "events", type: "EventEmitter" }).message).toBe(
      "events returned an EventEmitter instance, which cannot be sent to the browser. Return plain data.",
    );
    expect(new NotTransferable({ name: "stripe", type: "Stripe" }).message).toContain(
      "is a Stripe instance",
    );
  });

  it("follows the first sound: an HTMLDivElement, an Event, a Uint8Array, a URL, an Undo", () => {
    const of = (type: string) =>
      new ArgumentNotSerializable({ name: "f", argIndex: 0, type }).message.split(" ").slice(5, 7);
    expect(["HTMLDivElement", "Event", "Uint8Array", "URL", "Undo", "Stripe"].map(of)).toEqual([
      ["an", "HTMLDivElement"],
      ["an", "Event"],
      ["a", "Uint8Array"],
      ["a", "URL"],
      ["an", "Undo"],
      ["a", "Stripe"],
    ]);
  });
});

describe("the article before an acronym or a U", () => {
  it("reads an acronym letter by letter: an SVGSVGElement, an XMLHttpRequest, an RTCPeerConnection, a DOMException", () => {
    const of = (type: string) =>
      new ArgumentNotSerializable({ name: "f", argIndex: 0, type }).message.split(" ")[5];
    const types = [
      "SVGSVGElement",
      "XMLHttpRequest",
      "RTCPeerConnection",
      "IDBDatabase",
      "S3Client",
    ];
    expect(types.map(of)).toEqual(["an", "an", "an", "an", "an"]);
    expect(["DOMException", "V8Error"].map(of)).toEqual(["a", "a"]);
  });

  it("reads a U by its sound: an Update, an Upload, an Undo, a Unicode, a UserError, a Uint8Array", () => {
    const of = (type: string) =>
      new ArgumentNotSerializable({ name: "f", argIndex: 0, type }).message.split(" ")[5];
    const types = ["Update", "Upload", "Undo", "Unicode", "UserError", "Uint8Array"];
    expect(types.map(of)).toEqual(["an", "an", "an", "a", "a", "a"]);
  });
});

describe("the bridge error data", () => {
  it("keep the identifiers", () => {
    const error = new ArgumentNotSerializable({ name: "f", argIndex: 0, type: "Socket" });
    expect(error.data).toEqual({ name: "f", argIndex: 0, type: "Socket" });
    expect(error.name).toBe("ArgumentNotSerializable");
    expect(new NotExported({ name: "f", cell: "c_a1b2c3", index: 1 }).data).toEqual({
      name: "f",
      cell: "c_a1b2c3",
      index: 1,
    });
    expect(error.message).toMatchSnapshot();
  });

  it("render several arguments, strings and undefined in a timeout", () => {
    expect(
      new RpcTimeout({ name: "f", args: ["a", undefined, { b: 1 }], timeoutMs: 1500 }).message,
    ).toMatchSnapshot();
  });
});
