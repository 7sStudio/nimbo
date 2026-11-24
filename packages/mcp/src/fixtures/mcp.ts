// The environment an MCP test starts its server in.

/** The environment of a test's MCP server: no NIMBO_* of the test's, a user config folder inside the workspace. */
export const testEnv = (cwd: string): Record<string, string | undefined> => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: `${cwd}/.user-config`,
});
