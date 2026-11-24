// The socket the connection speaks JSON-RPC over, in this package's own minimal types so that no Node or DOM type
// reaches the public API; the default is the platform WebSocket, which browsers and Node 26 both have.

/** What a socket reports to the connection. */
export type SocketEvents = {
  readonly open: () => void;
  /** A text frame is a string; anything else is answered as unreadable. */
  readonly message: (frame: unknown) => void;
  readonly close: (code: number) => void;
};

/** What the connection does with a socket. */
export type SocketLike = {
  readonly send: (text: string) => void;
  readonly close: (code: number) => void;
};

/** Opens a socket to `url` that reports to `events`. */
export type OpenSocket = (url: string, events: SocketEvents) => SocketLike;

/** The platform WebSocket behind SocketLike. */
export const openWebSocket: OpenSocket = (url, events) => {
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => {
    events.open();
  });
  socket.addEventListener("message", (event) => {
    events.message(event.data);
  });
  socket.addEventListener("close", (event) => {
    events.close(event.code);
  });
  return {
    send: (text) => {
      socket.send(text);
    },
    close: (code) => {
      socket.close(code);
    },
  };
};
