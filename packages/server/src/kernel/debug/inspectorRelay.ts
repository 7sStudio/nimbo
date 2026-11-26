// The kernel's side of the debugger's CDP relay (relay.ts): the kernel's inspector, reached over its WebSocket as a
// second client beside the daemon's own session, every method passed on.
import { WebSocket } from "ws";

import type { Log } from "../../events/log.js";
import type { CdpRelay } from "./relay.js";
import { openCdpRelay } from "./relay.js";

const maxMessageBytes = 256 * 1024 * 1024;

/** Opens the relay to the inspector at `url`; the first connection to its address is js-debug's. */
export function openInspectorRelay(url: string, log: Log): Promise<CdpRelay> {
  return openCdpRelay({
    log,
    connect: (deliver, lost) =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: maxMessageBytes });
        ws.once("open", () => {
          ws.off("error", reject);
          ws.on("error", lost);
          ws.on("close", lost);
          ws.on("message", (data: Buffer) => {
            try {
              deliver(JSON.parse(data.toString("utf8")));
            } catch {
              // a frame that is not JSON is none of the protocol's
            }
          });
          resolve({
            request: (id, method, params) => {
              ws.send(JSON.stringify({ id, method, params }));
            },
            close: () => {
              ws.close();
            },
          });
        });
        ws.once("error", reject);
      }),
  });
}
