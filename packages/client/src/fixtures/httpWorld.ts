// Each HTTP test owns its world: the peers it starts here are closed after the test.
import { afterEach } from "vitest";

import type { Peer } from "./peer.js";
import { startPeer } from "./peer.js";

/** Registers the cleanup and returns a starter for peers, on port 0 or a given one. */
export function httpWorld() {
  const peers: Peer[] = [];
  afterEach(async () => {
    await Promise.all(peers.splice(0).map((peer) => peer.close()));
  });
  return {
    peer: async (port?: number): Promise<Peer> => {
      const peer = await startPeer(port === undefined ? {} : { port });
      peers.push(peer);
      return peer;
    },
  };
}
