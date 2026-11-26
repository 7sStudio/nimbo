// Renders src/generated.ts from the registry: one typed method per command not tagged internal, grouped by domain,
// each with the registry description as its JSDoc.
import type { AnyCommand } from "@jsnb/core";
import { JsnbError } from "@jsnb/core";

/** A registry command and the name @jsnb/core exports it under. */
export type NamedCommand = { readonly exportName: string; readonly command: AnyCommand };

/** Members a client already has beside its domains (src/socket/client.ts), plus the names generated.ts uses. */
const taken = new Set([
  "bind",
  "bindOptional",
  "call",
  "close",
  "handle",
  "onStatus",
  "status",
  "subscribeNotebook",
  "subscribeWorkspace",
]);

const header =
  "// Generated from the @jsnb/core registry by scripts/generate.ts; edit the registry, not this file.";

const domainOf = (command: AnyCommand): string => {
  const domain = command.name.slice(0, command.name.indexOf("."));
  if (taken.has(domain)) {
    throw new JsnbError({
      name: "ReservedDomain",
      message: `The domain of ${command.name} is a name the client already uses; rename the domain.`,
      data: { command: command.name },
    });
  }
  return domain;
};

const doc = (description: string): string => `/** ${description.replaceAll("*/", "*\\/")} */`;

/** `run: bind(call, cellRun),`, or bindOptional with `{}` when the input has no required key. */
const method = ({ exportName, command }: NamedCommand): string => {
  const verb = command.name.slice(command.name.indexOf(".") + 1);
  const binding = command.input.safeParse({}).success
    ? `bindOptional(call, ${exportName}, {})`
    : `bind(call, ${exportName})`;
  return `  ${doc(command.description)}\n  ${verb}: ${binding},`;
};

const byDomain = (entries: readonly NamedCommand[]): ReadonlyMap<string, NamedCommand[]> => {
  const domains = new Map<string, NamedCommand[]>();
  for (const entry of entries) {
    const domain = domainOf(entry.command);
    domains.set(domain, [...(domains.get(domain) ?? []), entry]);
  }
  return domains;
};

const imports = (entries: readonly NamedCommand[]): string => {
  const names = entries.map((entry) => entry.exportName).sort((a, b) => (a < b ? -1 : 1));
  return [
    `import {\n${names.map((name) => `  ${name},`).join("\n")}\n} from "@jsnb/core";\n`,
    `import { bind, bindOptional } from "./call/bind.js";`,
    `import type { Caller } from "./call/caller.js";`,
  ].join("\n");
};

/** The source of generated.ts, before Prettier. */
export function renderClient(entries: readonly NamedCommand[]): string {
  const visible = entries.filter((entry) => !entry.command.tags.internal);
  const domains = byDomain(visible);
  const factories = [...domains].map(
    ([domain, members]) =>
      `const ${domain} = (call: Caller) => ({\n${members.map(method).join("\n")}\n}) as const;`,
  );
  const fields = [...domains.keys()].map((domain) => `  ${domain}: ${domain}(call),`);
  return [
    header,
    imports(visible),
    ...factories,
    "/** Every command not tagged internal, one method each, grouped by domain. */\n" +
      `export const bindCommands = (call: Caller) => ({\n${fields.join("\n")}\n}) as const;`,
    "/** The generated methods every client has, readonly at every level. */\n" +
      "export type Commands = ReturnType<typeof bindCommands>;",
  ].join("\n\n");
}
