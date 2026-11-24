// The language service's errors: the service cannot answer, a rename is refused.
import { JsnbError } from "./jsnbError.js";

type Reason = { readonly reason: string };
type Cause = { readonly cause?: unknown };

/** The language worker cannot answer (it failed twice in a row), or `editor.intellisense` is off. */
export class LanguageUnavailable extends JsnbError {
  declare readonly data: Reason;
  constructor(data: Reason, options: Cause = {}) {
    super({
      name: "LanguageUnavailable",
      message: `The language service is unavailable: ${data.reason}`,
      data,
      ...options,
    });
  }
}

/** `language.rename` refused: a package or built-in symbol, a reserved or invalid name. */
export class RenameRefused extends JsnbError {
  declare readonly data: Reason;
  constructor(data: Reason, options: Cause = {}) {
    super({ name: "RenameRefused", message: data.reason, data, ...options });
  }
}
