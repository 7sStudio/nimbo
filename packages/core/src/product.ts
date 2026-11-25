// The product's name and version, the one source of truth for both (02-architecture §10). A release build stamps the
// version it builds and its commit into the built copy of this module, so the CLI, the daemon and the page all report
// what was shipped; a checkout reports the version below and no commit. Kept free of imports: the release tools read
// this file directly.

/** The command and the product: what the launcher, the help and the installer call it. */
export const productName = "nimbo";

/** What a release build stamps: the version, and the release's short commit ("" when this is not one). */
const stamped: { readonly version: string; readonly commit: string } = {
  version: "0.1.1",
  commit: "",
};

export const productVersion = stamped.version;

/** The release's short commit, "" when this is not a release build. */
export const productCommit = stamped.commit;

type Env = Readonly<Record<string, string | undefined>>;

const xdgDefaults = { XDG_CONFIG_HOME: ".config", XDG_DATA_HOME: ".local/share" } as const;

/**
 * An XDG base folder, the one rule for every XDG variable the product reads: its value when it is an absolute path,
 * else `<home>/<default>` (the XDG specification: an unset, empty or relative value is ignored).
 */
export function xdgDir(env: Env, variable: keyof typeof xdgDefaults, home: string): string {
  const value = env[variable] ?? "";
  return value.startsWith("/") ? value : `${home}/${xdgDefaults[variable]}`;
}

/** The user config folder (07-file-format §6): `%APPDATA%\nimbo` on Windows, else `$XDG_CONFIG_HOME/nimbo`. */
export function productConfigDir(env: Env, home: string, platform: string): string {
  if (platform === "win32") {
    const appData =
      env.APPDATA === undefined || env.APPDATA === "" ? `${home}\\AppData\\Roaming` : env.APPDATA;
    return `${appData}\\${productName}`;
  }
  return `${xdgDir(env, "XDG_CONFIG_HOME", home)}/${productName}`;
}

/**
 * The product's data folder on macOS and Linux: `$XDG_DATA_HOME/nimbo`, else `~/.local/share/nimbo`. The installed
 * versions and the on-demand DuckDB binding live there, outside any one version, so an upgrade keeps them.
 */
export function productDataDir(env: Env, home: string): string {
  return `${xdgDir(env, "XDG_DATA_HOME", home)}/${productName}`;
}
