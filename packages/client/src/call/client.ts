// The shape every client has, over HTTP or a WebSocket: the generated methods and the generic typed call (03-api §3).
import type { Commands } from "../generated.js";
import type { Caller } from "./caller.js";

/** `client.cell.run(input)` for every public command, and `client.call(descriptor, input)` for any command. */
export type Client = Commands & {
  /** The typed call of 03-api §3; the internal commands (realm.attach, bridge.call, …) are reached through it. */
  readonly call: Caller;
};
