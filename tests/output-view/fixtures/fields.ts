// Filling the viewer's plain fields as a user does: the Filter chip's three fields and a column filter's popover.
/** A field by its data-part. */
const field = (part: string) => document.querySelector<HTMLInputElement>(`[data-part="${part}"]`);

/** Sets a field's value and tells the view, as typing (or picking, for a select) does. */
export function fill(part: string, value: string): void {
  const found = field(part);
  if (found === null) throw new Error(`no ${part}`);
  found.value = value;
  found.dispatchEvent(new Event(found instanceof HTMLSelectElement ? "change" : "input"));
}

/** Presses ↩ in a field. */
export const enter = (part: string, init: KeyboardEventInit = {}): void => {
  field(part)?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...init }),
  );
};
