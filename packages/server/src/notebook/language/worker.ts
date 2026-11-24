// The language worker's entry: one language project per notebook, one message at a time.
// Runs in a worker thread so that a program build never blocks the daemon's socket, a bridge call or a route.
import { parentPort, workerData } from "node:worker_threads";

import type { LanguageProject } from "@jsnb/language";
import { createLanguageProject } from "@jsnb/language";

import type { Snapshot, WorkerData, WorkerReply, WorkerRequest, WorkerTask } from "./protocol.js";

/** The worker's start data, checked: the daemon sends `{ root, fallbackTypeRoots }`. */
function startData(value: unknown): WorkerData {
  const record: Record<string, unknown> =
    typeof value === "object" && value !== null ? { ...value } : {};
  const roots = Array.isArray(record.fallbackTypeRoots) ? record.fallbackTypeRoots : [];
  return {
    root: typeof record.root === "string" ? record.root : "/",
    fallbackTypeRoots: roots.filter((root): root is string => typeof root === "string"),
  };
}

const data = startData(workerData);
const projects = new Map<string, LanguageProject>();

/** The notebook's project, synced to the snapshot. */
function projectOf(snapshot: Snapshot): LanguageProject {
  const project =
    projects.get(snapshot.notebook) ??
    createLanguageProject({ ...data, notebook: snapshot.notebook });
  projects.set(snapshot.notebook, project);
  project.sync(snapshot.cells, snapshot.env);
  return project;
}

function answer(task: WorkerTask): unknown {
  if (task.op === "reset") {
    for (const project of projects.values()) project.dispose();
    projects.clear();
    return null;
  }
  if (task.op === "close") {
    projects.get(task.notebook)?.dispose();
    projects.delete(task.notebook);
    return null;
  }
  const project = projectOf(task.snapshot);
  if (task.op === "diagnostics") return project.diagnostics(task.cell);
  if (task.op === "rename") return project.rename(task.cell, task.position, task.newName);
  return project[task.query](task.cell, task.position);
}

parentPort?.on("message", (request: WorkerRequest) => {
  let reply: WorkerReply;
  try {
    reply = { id: request.id, ok: true, value: answer(request) };
  } catch (error) {
    reply = {
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  parentPort?.postMessage(reply);
});
