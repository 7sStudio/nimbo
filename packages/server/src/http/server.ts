// The daemon's HTTP server (02-architecture §7): bound to 127.0.0.1 only, every request through the Host and Origin
// rules first, `/rpc` as POST and as the WebSocket upgrade, the page endpoints, and 404 for everything else; no CORS
// header on any answer (02-architecture §8). It stops by refusing new work, answering the calls under way (those the
// stop ended, as an install it stopped, within half a second), then closing every socket and the listener.
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";

import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import type { Declaration } from "../commands/context.js";
import type { Dispatch } from "../commands/dispatch.js";
import type { Log } from "../events/log.js";
import { pageCookieName } from "./auth.js";
import { isAllowed } from "./guard.js";
import type { PageEndpoints } from "./pages.js";
import { answerPage } from "./pages.js";
import { maxBodyBytes, sendStatus } from "./respond.js";
import { answerRpcPost } from "./rpcPost.js";
import { serveSocket } from "./socket.js";
import { onUpgrade } from "./upgrade.js";

export type HttpOptions = {
  /** 0 picks a free port. */
  readonly port: number;
  readonly token: string;
  /** The page cookie's value: random per start, never the token. */
  readonly pageKey: string;
  readonly dispatch: Dispatch;
  readonly pages: PageEndpoints;
  readonly log: Log;
};

export type DaemonHttp = {
  readonly port: number;
  /** Refuses new work, closes the sockets (code 1001) and the listener; resolves once it closed. */
  readonly close: () => Promise<void>;
};

/** The requests and calls under way: the stop answers them before it closes their sockets. */
type InFlight = {
  readonly track: (work: Promise<void>) => void;
  readonly settled: () => Promise<void>;
};

/** Settles once `work` did, or after half a second, whichever comes first. */
const withinGrace = (work: Promise<unknown>): Promise<unknown> =>
  Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, 500).unref())]);

function createInFlight(): InFlight {
  const works = new Set<Promise<void>>();
  return {
    track: (work) => {
      works.add(work);
      const done = (): void => {
        works.delete(work);
      };
      void work.then(done, done); // only its end matters here; its failure is handled where it runs
    },
    settled: async () => {
      await withinGrace(Promise.allSettled([...works]));
    },
  };
}

const listen = (server: Server, port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : port);
    });
  });

/** Closes every socket with 1001, then drops the ones that did not answer the close within half a second. */
async function closeSockets(wss: WebSocketServer): Promise<void> {
  const sockets = [...wss.clients];
  const closed = sockets.map(
    (ws) =>
      new Promise<void>((resolve) => {
        ws.once("close", () => {
          resolve();
        });
      }),
  );
  for (const ws of sockets) ws.close(1001, "The daemon is stopping");
  await withinGrace(Promise.all(closed));
  for (const ws of wss.clients) ws.terminate();
}

/** Listens on 127.0.0.1 and serves until `close`. */
export async function startHttp(options: HttpOptions): Promise<DaemonHttp> {
  let port = options.port;
  let accepting = true;
  const inFlight = createInFlight();
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxBodyBytes });
  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!isAllowed(request.headers, port)) {
      sendStatus(response, 403);
      return;
    }
    if (!accepting) {
      sendStatus(response, 503);
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/rpc") await answerRpcPost(request, response, options);
    else {
      const { token, pages, log } = options;
      const cookie = { name: () => pageCookieName(port), key: options.pageKey };
      await answerPage({ request, response, url, token, cookie, pages, log });
    }
  };
  const server = createServer((request, response) => {
    const answered = route(request, response).catch((error: unknown) => {
      options.log.error({ err: error, url: request.url }, "an HTTP request failed");
      if (response.headersSent) response.destroy();
      else sendStatus(response, 500);
    });
    inFlight.track(answered);
  });
  const serve = (ws: WebSocket, declaration: Declaration): void => {
    serveSocket(ws, {
      dispatch: options.dispatch,
      log: options.log,
      declaration,
      track: inFlight.track,
    });
  };
  server.on(
    "upgrade",
    onUpgrade({
      wss,
      token: options.token,
      port: () => port,
      accepting: () => accepting,
      serve,
      log: options.log,
    }),
  );
  port = await listen(server, options.port);
  return {
    port,
    close: async () => {
      accepting = false;
      await inFlight.settled(); // the calls the stop ended get their answers (an install it stopped, a run it ended)
      await closeSockets(wss);
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}
