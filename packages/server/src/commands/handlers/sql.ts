// The sql commands: the daemon's DuckDB binding, its status and its install on demand.
import { sqlInstall, sqlStatus } from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function sqlHandlers({ bus, sql }: Services): readonly Bound[] {
  return [
    bind(sqlStatus, () => Promise.resolve(sql.status())),
    bind(sqlInstall, () =>
      sql.install((progress) => {
        bus.emit("", "sql.progress", progress);
      }),
    ),
  ];
}
