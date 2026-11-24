// A NodeKernel context over stubs of the child process and the CDP session, for the failures no real child or
// inspector produces on demand (kernelState.failures.test.ts): the messages the stub child was sent and the log lines
// are recorded; the stub inspector answers every call at once.
import { createExecutions } from "../ipc/executions.js";
import type { Session } from "../ipc/kernelState.js";
import { createContext } from "../ipc/kernelState.js";
import type { DaemonMessage } from "../ipc/messages.js";
import { createRequests } from "../ipc/requests.js";

/** A context not started yet; `session` is a stub session the test may install; `sent` and `logs` record. */
export function world() {
  const sent: DaemonMessage[] = [];
  const logs: string[] = [];
  const context = createContext(
    { workspace: "/w", notebook: "t.jsnb", port: 1, onLog: (line: string) => logs.push(line) },
    createExecutions(() => 0),
    createRequests(),
    { chunk: () => undefined, refresh: () => undefined, line: (text) => text },
  );
  const session: Session = {
    child: {
      send: (message, callback) => {
        sent.push(message);
        callback(null);
        return true;
      },
    },
    ready: { type: "ready", pid: 7, inspectorUrl: "ws://127.0.0.1:1/x" },
    cdp: { send: () => Promise.resolve(undefined), paused: () => false, close: () => undefined },
  };
  return { context, session, sent, logs };
}
