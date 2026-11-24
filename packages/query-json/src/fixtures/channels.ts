// Worker channels over a real MessageChannel for the unit tests of the timers: the far port answers nothing, or what a
// given Serve answers. They stand in for a worker thread without mocking any module of ours.
import type { MessagePort } from "node:worker_threads";
import { MessageChannel } from "node:worker_threads";

import type { Serve, SpawnWorker } from "../worker/protocol.ts";
import { listenNode } from "../worker/listen-node.ts";

export type ChannelWorkers = {
  readonly spawn: SpawnWorker;
  readonly spawned: () => number;
  readonly terminated: () => number;
  /** Closes every port, so none keeps the test process alive. */
  readonly close: () => void;
};

/** Workers whose far end is `serve` (or nothing at all: a worker that never answers). */
export const channelWorkers = (serve?: Serve): ChannelWorkers => {
  const ports: MessagePort[] = [];
  let spawned = 0;
  let terminated = 0;
  const spawn: SpawnWorker = (_kind, _memoryMb, events) => {
    spawned += 1;
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    port1.on("message", (reply: unknown) => {
      events.onReply(reply);
    });
    if (serve) listenNode(port2, serve);
    return {
      post: (task) => {
        port1.postMessage(task);
      },
      terminate: () => {
        terminated += 1;
        port1.close();
        port2.close();
        return Promise.resolve();
      },
    };
  };
  return {
    spawn,
    spawned: () => spawned,
    terminated: () => terminated,
    close: () => {
      ports.forEach((port) => {
        port.close();
      });
    },
  };
};
