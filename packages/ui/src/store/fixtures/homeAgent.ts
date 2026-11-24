// What an agent does to the workspace in the Home tests, through the daemon fixture's own client (`cli`): a notebook
// created, and one whose cell runs for ever, its kernel busy once this resolves.
import type { Daemon } from "@jsnb/test-daemon";

export const agentCreates = async ({ client }: Daemon, path: string): Promise<void> => {
  await client.notebook.create({ path });
};

/** Creates `path` with a cell that never ends and runs it; answers the cell's id once the kernel is busy. */
export async function agentRunsForever(daemon: Daemon, path: string): Promise<string> {
  const { client, events } = daemon;
  await client.notebook.create({ path });
  const { cell } = await client.cell.add({
    notebook: path,
    type: "server",
    source: "await new Promise(() => {})",
  });
  await client.cell.run({ notebook: path, cell: cell.id, wait: false });
  await events.until(
    "kernel.status",
    (event) => event.notebook === path && event.data.state === "busy",
  );
  return cell.id;
}
