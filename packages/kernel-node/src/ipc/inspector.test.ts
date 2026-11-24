// Tests the one case of the CDP session that no real inspector produces on demand, over a stub socket: a frame that is
// neither an answer nor an event (not JSON, or JSON of another shape) goes to onInvalid. A real inspector sends only
// answers and events; everything else the session does is tested against real inspectors (inspector.integration.test.ts).
import { beforeAll, describe, expect, it } from "vitest";

import type { CdpSocket } from "./inspector.js";
import { sessionOver } from "./inspector.js";

/** Stub: an EventTarget standing in for the WebSocket, whose `frame` delivers a message no inspector would send. */
function stubSocket() {
  const target = new EventTarget();
  const socket: CdpSocket = {
    addEventListener: (type: string, listener: (event: { readonly data: unknown }) => void) => {
      target.addEventListener(type, listener as unknown as EventListener);
    },
    send: () => undefined,
    close: () => undefined,
  };
  const frame = (data: string) => target.dispatchEvent(new MessageEvent("message", { data }));
  return { socket, frame };
}

beforeAll(() => {
  // Node's and Zod's one-off costs (the first MessageEvent, the frame schemas' first parse) are not test time.
  const { socket, frame } = stubSocket();
  sessionOver(socket, { onPause: () => undefined, onInvalid: () => undefined });
  frame('{"id":1,"result":{}}');
  frame('{"method":"Debugger.resumed"}');
  frame("warm");
});

describe("sessionOver frames no inspector sends (stub)", () => {
  it("reports frames that are neither answers nor events to onInvalid", () => {
    const { socket, frame } = stubSocket();
    const invalid: string[] = [];
    sessionOver(socket, { onPause: () => undefined, onInvalid: (text) => invalid.push(text) });
    frame("not json");
    frame('{"hello":1}');
    expect(invalid).toEqual(["not json", '{"hello":1}']);
  });
});
