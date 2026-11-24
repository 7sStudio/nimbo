// Each socket test owns its world (09-testing §1.6): peers and clients it starts here are closed after the test.
import { afterEach } from "vitest";

import { connectSocket } from "../socket/client.js";
import type { SocketClient } from "../socket/client.js";
import type { SocketOptions } from "../socket/connection.js";
import type { Peer, PeerOptions } from "./peer.js";
import { startPeer } from "./peer.js";

/** Registers the cleanup and returns starters for peers and clients. */
export function socketWorld() {
  const peers: Peer[] = [];
  const clients: SocketClient[] = [];
  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    await Promise.all(peers.splice(0).map((peer) => peer.close()));
  });
  return {
    peer: async (options: PeerOptions = {}): Promise<Peer> => {
      const peer = await startPeer(options);
      peers.push(peer);
      return peer;
    },
    /** A ui client of `peer` with millisecond reconnects. */
    connect: (peer: Peer, options: Partial<SocketOptions> = {}): SocketClient => {
      const client = connectSocket({
        url: peer.url,
        token: peer.token,
        client: "ui",
        reconnect: { baseMs: 1, maxMs: 2 },
        ...options,
      });
      clients.push(client);
      return client;
    },
  };
}
