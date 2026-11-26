// The headless realm's page (02-architecture §4.5, 05-bridge): runtime-web's Realm with no editor around it, loaded by
// the daemon's headless browser when no tab holds a notebook. The daemon calls __nimboHeadless over the browser's pipe
// with the token, the notebook and the one-time key its attach must carry, so none is ever in a URL; the realm attaches as kind "headless" and answers the
// daemon's requests. It follows the notebook's debugger, so a bridge call's timeout does not count the time the server
// kernel is paused in it. A page that loses its socket is done: the daemon closes it and opens another when needed.
import type { DebugState } from "@jsnb/core";
import { commandByName, debugAfter, JsnbError } from "@jsnb/core";
import type { SocketClient } from "@jsnb/client";
import { connectSocket } from "@jsnb/client";
import type { PauseClock } from "@jsnb/runtime-web";
import { Realm, realmRequestMethods } from "@jsnb/runtime-web";

class NotACommand extends JsnbError {
  constructor(method: string) {
    super({ name: "NotACommand", message: `${method} is not a nimbo command` });
  }
}

/** The time the server kernel is paused in the debugger, from the notebook's state and its debug events. */
function serverPauses(client: SocketClient, notebook: string): PauseClock {
  let since: number | undefined;
  let held = 0;
  let debug: DebugState | undefined;
  const follow = (next: DebugState | undefined): void => {
    debug = next;
    const paused = next?.realms.server === "paused";
    if (paused) since ??= performance.now();
    else if (since !== undefined) {
      held += performance.now() - since;
      since = undefined;
    }
  };
  void client
    .subscribeNotebook({
      notebook,
      onState: (state) => {
        follow(state.debug);
      },
      onEvent: (event) => {
        if (
          debug !== undefined &&
          (event.type === "debug.paused" ||
            event.type === "debug.resumed" ||
            event.type === "debug.breakpoints")
        )
          follow(debugAfter(debug, event));
      },
      onError: () => undefined,
    })
    .catch(() => undefined);
  return { paused: () => since !== undefined, heldMs: () => held };
}

async function start(token: string, notebook: string, key: string): Promise<string> {
  Reflect.deleteProperty(globalThis, "__nimboHeadless");
  const client = connectSocket({ url: location.origin, token, client: "ui" });
  const transport = {
    call: (method: string, params: unknown) => {
      const command = commandByName(method);
      if (command === undefined) throw new NotACommand(method);
      return client.call(command, command.input.parse(params));
    },
  };
  const pauses = serverPauses(client, notebook);
  const realm = new Realm({ notebook, transport, kind: "headless", attachKey: key, pauses });
  for (const method of realmRequestMethods)
    client.handle(method, (params) => realm.handle(method, params));
  client.onStatus((status) => {
    if (status === "reconnecting") client.close();
  });
  return realm.attach();
}

Object.defineProperty(globalThis, "__nimboHeadless", { value: start, configurable: true });
