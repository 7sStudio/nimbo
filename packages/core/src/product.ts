// The product's name and version, the one source of truth for both (02-architecture §10). A release build stamps the
// version it builds and its commit into the built copy of this module, so the CLI, the daemon and the page all report
// what was shipped; a checkout reports the version below and no commit. Kept free of imports: the release tools read
// this file directly.

/** The command and the product: what the launcher, the help and the installer call it. */
export const productName = "nimbo";

/** What a release build stamps: the version, and the release's short commit ("" when this is not one). */
const stamped: { readonly version: string; readonly commit: string } = {
  version: "0.1.0",
  commit: "",
};

export const productVersion = stamped.version;

/** The release's short commit, "" when this is not a release build. */
export const productCommit = stamped.commit;

/**
 * The product's data folder on macOS and Linux: `$XDG_DATA_HOME/nimbo`, else `~/.local/share/nimbo`. The installed
 * versions and the on-demand DuckDB binding live there, outside any one version, so an upgrade keeps them.
 */
export function productDataDir(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  const xdg = env.XDG_DATA_HOME ?? "";
  // The XDG rule: a relative path is ignored, as if unset.
  return `${xdg.startsWith("/") ? xdg : `${home}/.local/share`}/${productName}`;
}
