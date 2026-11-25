// The headless realm's page (02-architecture §4.5, 05-bridge): runtime-web's Realm with no editor around it, loaded by
// the daemon's headless browser when no tab holds a notebook. The daemon calls __nimboHeadless over the browser's pipe
// with the token and the notebook, so neither is ever in a URL; the realm attaches as kind "headless" and answers the
// daemon's requests. A page that loses its socket is done: the daemon closes it and opens another when needed.
import { commandByName, JsnbError } from "@jsnb/core";
import { connectSocket } from "@jsnb/client";
import { Realm, realmRequestMethods } from "@jsnb/runtime-web";

class NotACommand extends JsnbError {
  constructor(method: string) {
    super({ name: "NotACommand", message: `${method} is not a nimbo command` });
  }
}

async function start(token: string, notebook: string): Promise<string> {
  Reflect.deleteProperty(globalThis, "__nimboHeadless");
  const client = connectSocket({ url: location.origin, token, client: "ui" });
  const transport = {
    call: (method: string, params: unknown) => {
      const command = commandByName(method);
      if (command === undefined) throw new NotACommand(method);
      return client.call(command, command.input.parse(params));
    },
  };
  const realm = new Realm({ notebook, transport, kind: "headless" });
  for (const method of realmRequestMethods)
    client.handle(method, (params) => realm.handle(method, params));
  client.onStatus((status) => {
    if (status === "reconnecting") client.close();
  });
  return realm.attach();
}

Object.defineProperty(globalThis, "__nimboHeadless", { value: start, configurable: true });
