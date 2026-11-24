// The library's workspace for the notebook's cells: the library's own DefaultWorkspace
// (workspace.ts of @codemirror/lsp-client 6.3.0, which it does not export) with one addition, displayFile: a cell's
// URI unfolds, selects and enters that cell and resolves with its editor; any other URI says which file and line.
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { LSPClient, WorkspaceFile } from "@codemirror/lsp-client";
import { LSPPlugin, Workspace } from "@codemirror/lsp-client";

import type { LanguageHost } from "./types.js";

class CellFile implements WorkspaceFile {
  doc: Text;
  constructor(
    readonly uri: string,
    readonly languageId: string,
    public version: number,
    public view: EditorView,
  ) {
    this.doc = view.state.doc;
  }

  getView(): EditorView {
    return this.view;
  }
}

/** The cell id a cell URI ends with (`jsnb:///demo.jsnb/c_a1b2c3.ts`), or undefined for another URI. */
const cellOf = (uri: string): string | undefined => /\/(c_[0-9a-z]{6})\.ts$/u.exec(uri)?.[1];

export class CellWorkspace extends Workspace {
  override files: CellFile[] = [];
  private readonly versions = new Map<string, number>();

  constructor(
    client: LSPClient,
    private readonly host: () => LanguageHost,
  ) {
    super(client);
  }

  private nextVersion(uri: string): number {
    const version = (this.versions.get(uri) ?? -1) + 1;
    this.versions.set(uri, version);
    return version;
  }

  override syncFiles() {
    const updates = [];
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view);
      if (!plugin) continue;
      const changes = plugin.unsyncedChanges;
      if (changes.empty) continue;
      updates.push({ changes, file, prevDoc: file.doc });
      file.doc = file.view.state.doc;
      file.version = this.nextVersion(file.uri);
      plugin.clear();
    }
    return updates;
  }

  override openFile(uri: string, languageId: string, view: EditorView): void {
    const open = this.getFile(uri);
    // a cell's editor made again (unfolded, or the plugin given anew): the newer view holds the file
    if (open instanceof CellFile) this.closeFile(uri);
    const file = new CellFile(uri, languageId, this.nextVersion(uri), view);
    this.files.push(file);
    this.client.didOpen(file);
  }

  override closeFile(uri: string, view?: EditorView): void {
    const file = this.getFile(uri);
    // an older view's plugin going after a newer view opened the file leaves the newer one open
    if (!file || (view !== undefined && file.getView() !== view)) return;
    this.files = this.files.filter((each) => each !== file);
    this.client.didClose(uri);
  }

  override async displayFile(uri: string): Promise<EditorView | null> {
    const cell = cellOf(uri);
    if (cell !== undefined) return this.host().openCell(cell);
    // a file outside the cells: the daemon puts its line in the fragment (#L12, 1-based)
    const url = new URL(uri);
    const line = Number(/^#L(\d+)$/u.exec(url.hash)?.[1] ?? "1") - 1;
    const path = url.protocol === "file:" ? decodeURIComponent(url.pathname) : uri;
    this.host().showFile(path, line);
    return null;
  }
}
