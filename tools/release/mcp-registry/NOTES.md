# MCP Registry listing (draft, not published)

`server.json` is a draft for the official MCP Registry (registry.modelcontextprotocol.io, in preview). The
registry lists metadata only; for a server that is not on npm, PyPI, NuGet or crates.io it accepts an MCPB
bundle hosted as a GitHub or GitLab release asset (`registryType: "mcpb"`, the asset URL containing "mcp",
its `fileSha256`), or an OCI image. Still required before `mcp-publisher publish`:

- the repository public, and an `.mcpb` bundle per target built by the release workflow (a bundle's own
  `manifest.json` follows the MCPB specification, which is not covered here), with the real SHA-256 values in
  place of the zeros above and the version of the release;
- the `io.github.7sstudio` namespace, which needs GitHub Actions OIDC or a token login for an organisation
  (`mcp-publisher login github --token …`), or a DNS-verified domain namespace instead;
- the registry's docs do not say how a client picks among per-platform MCPB entries: check before publishing,
  or list the installer (`websiteUrl`) without packages.

Until then the server is registered locally with `nimbo mcp install`.
