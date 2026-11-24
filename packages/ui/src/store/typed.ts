// The cell editors on the page that can take a text as if the user typed it, by cell id: a revert of an agent's edit
// goes through the cell's editor when it has one, so it is an ordinary edit its undo (⌘Z) takes back.
type Write = (text: string) => void;

const editors = new Map<string, Write>();

/** Registers the editor of `cell`; the answer unregisters it (a later editor of the same cell is kept). */
export function addTypedEditor(cell: string, write: Write): () => void {
  editors.set(cell, write);
  return () => {
    if (editors.get(cell) === write) editors.delete(cell);
  };
}

/** Types `text` into the editor of `cell`; false when the page shows no editor for it. */
export function typeInto(cell: string, text: string): boolean {
  const write = editors.get(cell);
  if (write === undefined) return false;
  write(text);
  return true;
}
