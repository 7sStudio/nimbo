// The failure of a request to js-debug.

/** A request js-debug refused, did not answer, or answered with a body the daemon cannot read. */
export class DapFailed extends Error {
  constructor(command: string, message: string) {
    super(`${command}: ${message}`);
    this.name = "DapFailed";
  }
}
