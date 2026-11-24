// The generated surface's words (03-api §8): `nimbo <domain> <verb>` for every registry command not tagged internal,
// the verb in kebab-case (`cell.outputQuery` → `nimbo cell output-query`); internal commands have no words at all.
import type { AnyCommand } from "@jsnb/core";
import { publicCommands } from "@jsnb/core";

/** `outputQuery` → `output-query`, `timeoutMs` → `timeout-ms`. */
export const kebab = (name: string): string =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const domainOf = (command: AnyCommand): string => command.name.split(".")[0] ?? "";

export const verbOf = (command: AnyCommand): string => kebab(command.name.split(".")[1] ?? "");

/** `cell output-query`: what a user types after `nimbo`. */
export const wordsOf = (command: AnyCommand): string => `${domainOf(command)} ${verbOf(command)}`;

/** Every public command by domain, both in registry order. */
export function commandsByDomain(): ReadonlyMap<string, readonly AnyCommand[]> {
  const domains = new Map<string, AnyCommand[]>();
  for (const command of publicCommands()) {
    const domain = domainOf(command);
    domains.set(domain, [...(domains.get(domain) ?? []), command]);
  }
  return domains;
}

/** The public command `nimbo <domain> <verb>` names, or undefined. */
export function findCommand(domain: string, verb: string): AnyCommand | undefined {
  return commandsByDomain()
    .get(domain)
    ?.find((command) => verbOf(command) === verb);
}
