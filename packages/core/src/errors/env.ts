// The env errors of 04-kernel §8: a name with no value, and a non-public name read in a client cell.
import { JsnbError } from "./jsnbError.js";

type Name = { readonly name: string };
type Cause = { readonly cause?: unknown };

const envNotSetMessage = ({ name }: Name): string =>
  `env.${name} is not set. Add it to .env or run: nimbo secrets set ${name}`;

/** `env.X` read in either realm when the workspace `.env` has no `X` (04-kernel §8). */
export class EnvNotSet extends JsnbError {
  declare readonly data: Name;
  constructor(data: Name, options: Cause = {}) {
    super({ name: "EnvNotSet", message: envNotSetMessage(data), data, ...options });
  }
}

const envNotPublicMessage = ({ name }: Name): string =>
  `env.${name} is not visible in client cells: only PUBLIC_* and *_PUBLISHABLE_KEY names reach the browser. ` +
  "Read it in a server cell and export a function that uses it.";

/** `env.X` read in a client cell when `X` is neither `PUBLIC_*` nor `*_PUBLISHABLE_KEY` (04-kernel §8). */
export class EnvNotPublic extends JsnbError {
  declare readonly data: Name;
  constructor(data: Name, options: Cause = {}) {
    super({ name: "EnvNotPublic", message: envNotPublicMessage(data), data, ...options });
  }
}
