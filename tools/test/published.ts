// A published package never depends at run time on a private workspace package, which no registry can
// resolve. Its devDependencies may name one (output-view bundles core from there); dependencies and peerDependencies
// may not. This reads the workspace's package.json files and lists every such dependency.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type Manifest = {
  readonly name?: string;
  readonly private?: boolean;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
};

const record = (value: unknown): Readonly<Record<string, string>> | undefined =>
  typeof value === "object" && value !== null
    ? Object.fromEntries(Object.keys(value).map((key) => [key, String(Reflect.get(value, key))]))
    : undefined;

/** The fields of a parsed package.json this check reads. */
function manifestOf(json: unknown): Manifest {
  if (typeof json !== "object" || json === null) return {};
  const name: unknown = Reflect.get(json, "name");
  return {
    ...(typeof name === "string" ? { name } : {}),
    private: Reflect.get(json, "private") === true,
    ...withRecord("dependencies", record(Reflect.get(json, "dependencies"))),
    ...withRecord("peerDependencies", record(Reflect.get(json, "peerDependencies"))),
  };
}
const withRecord = (field: string, value: Readonly<Record<string, string>> | undefined) =>
  value === undefined ? {} : { [field]: value };

/** "<package> → <private package> (<field>)" for every run-time dependency of a public package on a private one. */
export function privateDependencies(manifests: readonly Manifest[]): string[] {
  const hidden = new Set(manifests.flatMap((m) => (m.private === true && m.name ? [m.name] : [])));
  return manifests
    .filter((m) => m.private !== true)
    .flatMap((m) =>
      (["dependencies", "peerDependencies"] as const).flatMap((field) =>
        Object.keys(m[field] ?? {})
          .filter((name) => hidden.has(name))
          .map((name) => `${m.name ?? "?"} → ${name} (${field})`),
      ),
    );
}

/** The package.json of every workspace member: the `packages:` globs of pnpm-workspace.yaml, `dir/*` or `dir`. */
export function workspaceManifests(root: string): Manifest[] {
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const block = /^packages:\n((?:\s+- .+\n)+)/m.exec(yaml)?.[1] ?? "";
  const globs = [...block.matchAll(/- (.+)/g)].map((match) => (match[1] ?? "").trim());
  const folders = globs.flatMap((glob) => {
    if (!glob.endsWith("/*")) return [glob];
    const parent = glob.slice(0, -2);
    return existsSync(join(root, parent))
      ? readdirSync(join(root, parent)).map((name) => `${parent}/${name}`)
      : [];
  });
  return folders
    .map((folder) => join(root, folder, "package.json"))
    .filter((file) => existsSync(file))
    .map((file) => manifestOf(JSON.parse(readFileSync(file, "utf8"))));
}
