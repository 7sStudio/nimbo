// Results that pass core's output schemas (03-api §4, §5), for the transport tests.
import type { Cell, Execution } from "@jsnb/core";

export const cell: Cell = {
  id: "c_a1b2c3",
  type: "server",
  source: "1 + 1",
  index: 0,
  meta: {},
  status: "idle",
  stale: false,
  lastExecution: null,
};

export const queued: Execution = {
  id: "x_a1b2c3d4",
  cell: "c_a1b2c3",
  status: "queued",
  startedAt: "2026-10-12T00:00:00.000Z",
  outputs: [],
};

export const workspace = {
  root: "/tmp/w",
  apiVersion: 1,
  serverVersion: "0.0.0",
  nodeVersion: "26.7.0",
  pid: 4242,
  startedAt: "2026-10-12T00:00:00.000Z",
  notebooks: [
    { path: "demo.jsnb", open: true, modifiedAt: "2026-10-10T14:02:11.000Z", bytes: 412 },
  ],
};
