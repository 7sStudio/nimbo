// The client realm's test page (the server's daemon-side realm tests): runtime-web's Realm over
// @jsnb/client's socket, mounted as the ui mounts it (one socket, the daemon's requests answered by the realm,
// its calls sent as the registry's commands), attached to the notebook the URL names (`/ui/<notebook>?token=…`).
// `window.jsnbRealm` gives the test the attach's outcome, a detach, an attach again with the page's runs kept, a
// takeover, and whether another page took this one's place.
import { connectSocket } from "@jsnb/client";
import { commands } from "@jsnb/core";
import { Realm, realmRequestMethods } from "@jsnb/runtime-web";

type Attach =
  | { readonly ok: true; readonly realmId: string }
  | { readonly ok: false; readonly name: string; readonly code: unknown };

const token = new URLSearchParams(location.search).get("token") ?? "";
const notebook = decodeURIComponent(location.pathname.slice("/ui/".length));
const client = connectSocket({ url: location.origin, token, client: "ui" });
const byName = new Map(commands.map((command) => [command.name, command]));

const realm = new Realm({
  notebook,
  transport: {
    call: async (method, params) => {
      const command = byName.get(method);
      if (!command) throw new Error(`${method} is not a nimbo command`);
      return client.call(command, command.input.parse(params));
    },
  },
});
/** Set once another page took the notebook over (realm.reset { takenOver }). */
let takenOver = false;
for (const method of realmRequestMethods) {
  client.handle(method, async (params) => {
    const answer = await realm.handle(method, params);
    if (method === "realm.reset" && "takenOver" in params && params.takenOver === true)
      takenOver = true;
    return answer;
  });
}

const attached: Promise<Attach> = realm.attach().then(
  (realmId): Attach => ({ ok: true, realmId }),
  (error: unknown): Attach => ({
    ok: false,
    name: error instanceof Error ? error.name : "unknown",
    code: typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined,
  }),
);

Object.assign(window, {
  jsnbRealm: {
    attached,
    detach: () => realm.detach(),
    reattach: () => realm.attach(),
    takeOver: () => realm.attach(true),
    takenOver: () => takenOver,
  },
});
