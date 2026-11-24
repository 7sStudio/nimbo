// Format migrations of 07-file-format §4: pure steps from one version to the next, run in order on load.

export type RawNotebook = Readonly<Record<string, unknown>>;

export type Migration = {
  readonly from: number;
  readonly to: number;
  /** Returns the notebook in the `to` shape; the loader sets `version` afterwards. */
  readonly run: (raw: RawNotebook) => RawNotebook;
};

/** Every step in ascending order; empty while version 1 is the only version. */
export const migrations: readonly Migration[] = [];

export type Migrated = { readonly raw: RawNotebook; readonly migrated: boolean };

/** Applies every step whose `from` matches the notebook's version, in order. */
export function migrate(raw: RawNotebook, steps: readonly Migration[] = migrations): Migrated {
  let current = raw;
  let migrated = false;
  for (const step of steps) {
    if (current.version !== step.from) continue;
    current = { ...step.run(current), version: step.to };
    migrated = true;
  }
  return { raw: current, migrated };
}
