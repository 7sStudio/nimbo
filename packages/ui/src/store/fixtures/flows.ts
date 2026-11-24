// The flows recorded into this folder's event logs (the reducer is tested against recorded logs): each one
// drives a real daemon through what a user or an agent does to a notebook. record.integration.test.ts runs them.
import { chmod, writeFile } from "node:fs/promises";

import type { Daemon } from "@jsnb/test-daemon";
import type { Workspace } from "@jsnb/test-tools/workspace";

export const notebook = "flow.jsnb";

export type Flow = (daemon: Daemon, ws: Workspace) => Promise<void>;

const server = { notebook, type: "server" } as const;

const edits: Flow = async ({ client }) => {
  const a = await client.cell.add({ ...server, source: "export const a = 1" });
  const b = await client.cell.add({ ...server, source: "a + 1" });
  const md = await client.cell.add({ notebook, type: "markdown", source: "# Title", after: null });
  await client.cell.update({ notebook, cell: b.cell.id, source: "a + 2" });
  await client.cell.update({ notebook, cell: b.cell.id, type: "client" });
  await client.cell.update({
    notebook,
    cell: a.cell.id,
    meta: { collapsed: true, showBindings: true },
  });
  await client.cell.move({ notebook, cell: md.cell.id, after: b.cell.id });
  await client.cell.delete({ notebook, cell: a.cell.id });
};

const runs: Flow = async ({ client }) => {
  const a = await client.cell.add({
    ...server,
    source: "export const a = 1; console.log('hi'); a",
  });
  await client.cell.add({ ...server, source: "a + 1", run: true });
  await client.cell.run({ notebook, cell: a.cell.id });
  await client.cell.add({ ...server, source: "throw new TypeError('boom')", run: true });
  await client.cell.update({ notebook, cell: a.cell.id, source: "export const a = 2; a" });
  await client.notebook.run({ notebook, select: { stale: true } });
  await client.notebook.run({ notebook, select: "all", stopOnError: false });
};

const restart: Flow = async ({ client }) => {
  await client.cell.add({ ...server, source: "export const r = 1; r", run: true });
  await client.kernel.restart({ notebook });
  await client.cell.add({ ...server, source: "1 + 1", run: true });
};

const death: Flow = async ({ client, events }) => {
  await client.cell.add({ ...server, source: "export const d = 1", run: true });
  const kernel = await client.kernel.status({ notebook });
  if (kernel.pid !== null) process.kill(kernel.pid, "SIGKILL");
  await events.until("kernel.status", (event) => event.data.state === "dead");
  await client.cell.add({ ...server, source: "2 + 2", run: true });
};

const interrupt: Flow = async ({ client, events }) => {
  const spin = await client.cell.add({ ...server, source: "while (true) {}" });
  await client.cell.run({ notebook, cell: spin.cell.id, wait: false });
  await events.until("cell.status", (event) => event.data.status === "running");
  await client.kernel.interrupt({ notebook });
  await events.until("cell.status", (event) => event.data.status === "interrupted");
};

const routes: Flow = async ({ client }) => {
  const cell = await client.cell.add({
    ...server,
    source: 'route("GET /ping", () => "pong")',
    run: true,
  });
  await client.cell.update({
    notebook,
    cell: cell.cell.id,
    source: 'route("GET /pong", () => "ping")',
  });
  await client.cell.run({ notebook, cell: cell.cell.id });
};

const saves: Flow = async ({ client, events }, ws) => {
  await client.cell.add({ ...server, source: "1" });
  await client.notebook.save({ notebook });
  await chmod(ws.dir, 0o555);
  try {
    await client.cell.add({ ...server, source: "2" });
    await events.until("notebook.saveFailed");
  } finally {
    await chmod(ws.dir, 0o755);
  }
  await client.notebook.save({ notebook });
  await writeFile(ws.path(notebook), '{"version":1,"cells":[]}\n');
  await client.cell.add({ ...server, source: "3" });
  await events.until("notebook.conflict");
  await client.notebook.save({ notebook, force: true });
  await writeFile(ws.path(notebook), '{"version":1,"cells":[]}\n');
  await client.notebook.reload({ notebook });
};

/** Every flow by its fixture name. */
export const flows: Readonly<Record<string, Flow>> = {
  edits,
  runs,
  restart,
  death,
  interrupt,
  routes,
  saves,
};
