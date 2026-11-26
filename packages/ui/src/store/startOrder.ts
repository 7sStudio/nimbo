// The page's start-order errors: a store or a view reached the session or the dispatcher before
// the page's start provided it, a bug in the page, never a user's error.
import { JsnbError } from "@jsnb/core";

/** A store read the session before useSessionStore().start resolved. */
export class SessionNotStarted extends JsnbError {
  constructor() {
    super({ name: "SessionNotStarted", message: "the page's session has not started" });
  }
}

/** A view asked for the dispatcher before the page's start provided it. */
export class DispatcherMissing extends JsnbError {
  constructor() {
    super({
      name: "DispatcherMissing",
      message: "no dispatcher provided; the page's start provides it",
    });
  }
}
