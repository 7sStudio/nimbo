// Opens a socket so that its events always find the handle (03-api §7.2): an OpenSocket may report open, message or
// close before it returns, so those early events are held and delivered once the connection has taken the handle.
import type { OpenSocket, SocketLike } from "./socketLike.js";

/** What the connection does with each event, given the socket it came from. */
export type SocketHandlers = {
  readonly open: (socket: SocketLike) => void;
  readonly message: (socket: SocketLike, frame: unknown) => void;
  readonly close: (socket: SocketLike, code: number) => void;
};

type HeldEvent = (socket: SocketLike) => void;

/** Opens through `open`, hands the socket to `adopt`, then delivers its events in order, the early ones first. */
export function openInOrder(
  open: OpenSocket,
  url: string,
  adopt: (socket: SocketLike) => void,
  handlers: SocketHandlers,
): void {
  const held: { adopted: SocketLike | undefined } = { adopted: undefined };
  const early: HeldEvent[] = [];
  const report = (event: HeldEvent): void => {
    if (held.adopted) event(held.adopted);
    else early.push(event);
  };
  const socket = open(url, {
    open: () => {
      report(handlers.open);
    },
    message: (frame) => {
      report((source) => {
        handlers.message(source, frame);
      });
    },
    close: (code) => {
      report((source) => {
        handlers.close(source, code);
      });
    },
  });
  adopt(socket);
  held.adopted = socket;
  for (const event of early.splice(0)) event(socket);
}
