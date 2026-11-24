// The client over HTTP (03-api §7.3), what the CLI uses for one-shot commands: the generated methods and `call`.
import type { Client } from "../call/client.js";
import { createCaller } from "../call/caller.js";
import { bindCommands } from "../generated.js";
import type { HttpOptions } from "./options.js";
import { createHttpTransport } from "./transport.js";

/** A client that sends each call as its own POST /rpc; there are no events over HTTP (03-api §7.3). */
export function createHttpClient(options: HttpOptions): Client {
  const call = createCaller(createHttpTransport(options));
  return { ...bindCommands(call), call };
}
