// Who asked for a run (Execution.requestedBy), as the page's Activity log says it: the declaration of the
// connection behind cell.add with run, cell.run and notebook.run, kept on the execution cell.outputs answers.
import { withDaemon } from "../../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

const notebook = "a.jsnb";

describe("Execution.requestedBy", () => {
  it("names the connection that asked for each run", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const mcp = daemon.socket({ client: "mcp", agent: "claude-code" });
      const added = await mcp.cell.add({ notebook, type: "server", source: "1 + 1", run: true });
      expect(added.execution?.requestedBy).toEqual({ client: "mcp", agent: "claude-code" });
      const ref = { notebook, cell: added.cell.id };
      const ui = await daemon.socket({ client: "ui" }).cell.run(ref);
      expect(ui.execution.requestedBy).toEqual({ client: "ui" });
      const all = await daemon.http({ client: "cli" }).notebook.run({ notebook, select: "all" });
      expect(all.executions.map((run) => run.requestedBy)).toEqual([{ client: "cli" }]);
      const outputs = await daemon.client.cell.outputs(ref);
      expect(outputs.execution?.requestedBy).toEqual({ client: "cli" });
    });
  });
});
