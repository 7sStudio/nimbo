// `nimbo --help` (03-api §8): the shortcuts, the domains generated from the registry with their verbs, the global
// flags, the exit codes and the environment; a golden snapshot holds it (09-testing §3).
import { columns } from "./commands/help.js";
import { commandsByDomain, verbOf } from "./commands/names.js";
import { shortcuts } from "./shortcuts/all.js";

const globalFlags = columns([
  [
    "--json",
    "print the output as one JSON document; errors go to stderr as { code, name, message, data }",
  ],
  ["--yes, -y", "skip the y/N question of a destructive command"],
  ["--help, -h", "help for nimbo, a shortcut, a domain or a command"],
  ["--version", "the CLI's version and API version"],
  ["--flag=-…", "a value that starts with - (a markdown list, -1): --source='- item', --jq='-.a'"],
]);

const environment = columns([
  ["NIMBO_NOTEBOOK", "the notebook -n defaults to"],
  [
    "NIMBO_DAEMON_ENTRY",
    "the absolute path of the daemon entry to start instead of the installed one",
  ],
  [
    "NIMBO_UI_DIR",
    "the absolute path of a built UI folder the daemon serves instead of the installed one",
  ],
]);

/** The shortcut and domain sections, both from what is registered. */
function commandSections(): string[] {
  const domains = [...commandsByDomain()].map(
    ([domain, commands]) => [domain, commands.map(verbOf).join(", ")] as const,
  );
  return [
    "Shortcuts (nimbo <shortcut> --help for its flags):",
    ...shortcuts.flatMap((shortcut) => [`  nimbo ${shortcut.usage}`, `      ${shortcut.summary}`]),
    "",
    "Domains, generated from the command registry (nimbo <domain> --help lists the verbs, nimbo <domain> <verb> --help",
    "the flags; a verb is the registry's name in kebab-case, cell.outputQuery is nimbo cell output-query):",
    ...columns(domains),
  ];
}

/** The root help. */
export function rootHelp(): string {
  return [
    "nimbo: notebooks for JavaScript and TypeScript, from the command line",
    "",
    "Usage:",
    "  nimbo <shortcut> [arguments] [flags]",
    "  nimbo <domain> <verb> [flags]",
    "  nimbo                 typed on a terminal in a workspace, its Home page in the browser; else this help",
    "",
    ...commandSections(),
    "",
    "Global flags:",
    ...globalFlags,
    "",
    "Exit codes: 0 ok; 1 a run ended in error; 2 usage or invalid params; 3 no daemon reachable; 4 any other error;",
    "130 interrupted (Ctrl-C).",
    "",
    "Environment:",
    ...environment,
    "",
  ].join("\n");
}
