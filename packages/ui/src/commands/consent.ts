// The yes of a page command that can lose work: a one-time token a confirm dialog creates when it opens and puts in
// the arguments its button sends. A key binding (a workspace's keybindings.json comes with a clone), the palette or a
// URL cannot make one, so only the dialog's own button can say yes. Key bindings also lose every yes-like argument.
import type { Args } from "./command.js";

const granted = new Set<string>();

/** A fresh token for a dialog's button. */
export function consent(): string {
  const token = crypto.randomUUID();
  granted.add(token);
  return token;
}

/** Whether `args` carry a token a dialog made; a token answers once. */
export function consented(args: Args | undefined): boolean {
  const token = args?.consent;
  return typeof token === "string" && granted.delete(token);
}

const yesLike = new Set(["consent", "confirm", "confirmed", "force", "yes"]);

/** A key binding's arguments without anything that would say yes or force. */
export const bindingArgs = (args: Args | undefined): Args | undefined =>
  args === undefined
    ? undefined
    : Object.fromEntries(Object.entries(args).filter(([key]) => !yesLike.has(key)));
