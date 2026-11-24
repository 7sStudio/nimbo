// How the MCP server presents itself: its `serverInfo` in `initialize`, the MCP bundle's manifest and the MCP Registry
// listing (02-architecture §10) say the same. Kept free of imports: the release tools read this file directly.

export const listingTitle = "nimbo: a Jupyter-style notebook for JavaScript and TypeScript";

/** At most 100 characters, the registry's limit. */
export const listingDescription =
  "Read, edit, run and debug notebook cells; query outputs with JSONPath, jq or SQL; manage packages.";

export const listingWebsite = "https://github.com/7sStudio/nimbo";
