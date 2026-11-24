// Moves the keys this browser kept under the app's old `jsnb.` prefix (layout, theme, syntax theme, debugger watches)
// to `nimbo.`, once: a key already under the new name wins and the old one is dropped. Storage that throws (a private
// window, blocked site data) leaves everything as it is.
const oldPrefix = "jsnb.";
const newPrefix = "nimbo.";

export function moveLegacyStorageKeys(storage: Storage | undefined): void {
  try {
    if (storage === undefined) return;
    const old: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(oldPrefix) === true) old.push(key);
    }
    for (const key of old) {
      const renamed = newPrefix + key.slice(oldPrefix.length);
      const value = storage.getItem(key);
      if (value !== null && storage.getItem(renamed) === null) storage.setItem(renamed, value);
      storage.removeItem(key);
    }
  } catch {
    // no storage: the defaults apply
  }
}
