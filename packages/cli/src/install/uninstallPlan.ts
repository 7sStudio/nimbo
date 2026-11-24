// What `uninstall` removes and keeps (02-architecture §10), worked out from what is on disk before anything goes: the
// versions with their sizes, DuckDB, the command's link when it is this install's, the profile files holding the
// installer's PATH line, the MCP registrations it made, and the settings unless purged.
import { homedir } from "node:os";
import { join } from "node:path";

import { productName } from "@jsnb/core";

import type { Registration } from "./agents.js";
import { versionsDirOf } from "./local.js";

/** The marker line the installer writes above its PATH line. */
export const profileMarker = `# added by the ${productName} installer`;

/** `text` without the installer's marker line, the PATH line under it and the blank line it wrote above them. */
export function withoutProfileLine(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === profileMarker) {
      if (kept.at(-1) === "") kept.pop();
      index += 1; // the PATH line the marker stands above
      continue;
    }
    kept.push(lines[index] ?? "");
  }
  return kept.join("\n");
}

/** The shell profile files the installer may have written to, as it picks them. */
export function candidateProfiles(env: Readonly<Record<string, string | undefined>>): string[] {
  const home = env.HOME ?? homedir();
  const zdot = env.ZDOTDIR === undefined || env.ZDOTDIR === "" ? home : env.ZDOTDIR;
  const config =
    env.XDG_CONFIG_HOME === undefined || env.XDG_CONFIG_HOME === ""
      ? join(home, ".config")
      : env.XDG_CONFIG_HOME;
  return [
    join(zdot, ".zshrc"),
    join(home, ".bashrc"),
    join(home, ".bash_profile"),
    join(home, ".profile"),
    join(config, "fish", "config.fish"),
  ];
}

export type PlanItem = { readonly label: string; readonly path?: string; readonly size?: number };

export type UninstallFacts = {
  readonly dataDir: string;
  readonly versions: readonly { readonly version: string; readonly size: number }[];
  readonly duckdb: number;
  readonly bin: string;
  /** The launcher is a link into this install's versions. */
  readonly owned: boolean;
  /** The profile files holding the installer's PATH line. */
  readonly profiles: readonly string[];
  readonly configDir: string;
  readonly purge: boolean;
  readonly registrations: readonly Registration[];
  readonly removeMcp: boolean;
};

export const agentLabels: Readonly<Record<Registration["agent"], string>> = {
  "claude-code": "Claude Code",
  vscode: "VS Code",
  cursor: "Cursor",
  "claude-desktop": "Claude Desktop",
};

const mcpItem = (registration: Registration): PlanItem => ({
  label: `the MCP registration in ${agentLabels[registration.agent]}${
    registration.scope === undefined ? "" : ` (${registration.scope} scope)`
  }`,
  ...(registration.file === undefined ? {} : { path: registration.file }),
});

/** Exactly what an uninstall removes and what it keeps. */
export function uninstallPlan(facts: UninstallFacts): {
  readonly remove: readonly PlanItem[];
  readonly keep: readonly PlanItem[];
} {
  const remove: PlanItem[] = [
    ...facts.versions.map(({ version, size }) => ({
      label: `${productName} ${version}`,
      path: join(versionsDirOf(facts.dataDir), version),
      size,
    })),
    ...(facts.duckdb > 0
      ? [{ label: "DuckDB for SQL", path: join(facts.dataDir, "duckdb"), size: facts.duckdb }]
      : []),
    ...(facts.owned ? [{ label: `the ${productName} command`, path: facts.bin }] : []),
    ...facts.profiles.map((path) => ({ label: "the PATH line in", path })),
    ...(facts.removeMcp ? facts.registrations.map(mcpItem) : []),
    ...(facts.purge ? [{ label: "your settings", path: facts.configDir }] : []),
  ];
  const keep: PlanItem[] = [
    ...(facts.purge ? [] : [{ label: "your settings", path: facts.configDir }]),
    ...(facts.owned
      ? []
      : [{ label: "a command that is not this install's link", path: facts.bin }]),
    ...(facts.removeMcp ? [] : facts.registrations.map(mcpItem)),
    { label: "every workspace and its .jsnb/ folder" },
  ];
  return { remove, keep };
}
