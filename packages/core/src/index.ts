// Public API of @jsnb/core: the notebook model, the .jsnb format, analysis, the command registry, JsnbError.
// Each file below exports only public names, so the API is the union of the files, one line each; knip counts a
// re-exported file's exports as used, so an unused name in one of them is caught by review, not by knip.

// the product
export * from "./product.js";

// model
export * from "./model/ids.js";
export * from "./model/cell.js";
export * from "./model/execution.js";
export * from "./model/settings.js";
export * from "./model/output.js";
export * from "./model/notebook.js";
export * from "./model/binding.js";
export * from "./model/selection.js";
export * from "./model/chip.js";
export * from "./model/events.js";
export * from "./model/workspace.js";
export * from "./model/summary.js";
export * from "./model/bridge.js";
export * from "./model/kernel.js";
export * from "./model/reserved.js";
export * from "./model/analysis.js";
export * from "./model/cellUrl.js";
export * from "./model/serverFile.js";
export * from "./model/notebookName.js";
export * from "./model/routePath.js";
export * from "./model/language.js";
export * from "./model/gitDiff.js";
export * from "./model/gitHistory.js";
export * from "./model/keybinding.js";
export * from "./model/debug.js";

// errors
export * from "./errors/jsnbError.js";
export * from "./errors/api.js";
export * from "./errors/realm.js";
export * from "./errors/notebook.js";
export * from "./errors/bridge.js";
export * from "./errors/kernel.js";
export * from "./errors/env.js";
export * from "./errors/builtins.js";
export * from "./errors/format.js";
export * from "./errors/analysis.js";
export * from "./errors/language.js";
export * from "./errors/git.js";

// serialize (the wire form and its codecs; the walker and its helpers stay internal)
export * from "./serialize/form.js";
export * from "./serialize/encode.js";
export * from "./serialize/decode.js";

// format
export * from "./format/schema.js";
export * from "./format/lines.js";
export * from "./format/parse.js";
export * from "./format/serialize.js";
export * from "./format/migrate.js";

// analysis (the graph, staleness and selection over CellAnalysis, the line diff of an edit; transform owns the analyser)
export * from "./analysis/graph.js";
export * from "./analysis/stale.js";
export * from "./analysis/selection.js";
export * from "./analysis/lineDiff.js";
export * from "./analysis/cellName.js";
export * from "./analysis/summary.js";
export * from "./analysis/lastResult.js";
export * from "./analysis/compareRuns.js";

// diff (the notebook diff of the Source Control view)
export * from "./diff/notebookDiff.js";
export { textDiff } from "./diff/textDiff.js";

// settings
export * from "./settings/schema.js";
export * from "./settings/resolve.js";
export * from "./settings/jsonSchema.js";
export * from "./settings/keybindingDefaults.js";
export * from "./settings/keybindingKeys.js";
export * from "./settings/keybindingWhen.js";
export * from "./settings/keybindings.js";
export * from "./settings/keybindingEdit.js";

// commands
export * from "./commands/define.js";
export * from "./commands/workspace.js";
export * from "./commands/notebook.js";
export * from "./commands/cell.js";
export * from "./commands/kernel.js";
export * from "./commands/realm.js";
export * from "./commands/packages.js";
export * from "./commands/sql.js";
export * from "./commands/secrets.js";
export * from "./commands/events.js";
export * from "./commands/debug.js";
export * from "./commands/examples.js";
export * from "./commands/feedback.js";
export * from "./commands/git.js";
export * from "./commands/gitBranch.js";
export * from "./commands/gitHistory.js";
export * from "./commands/gitRemote.js";
export * from "./commands/gitStash.js";
export * from "./commands/cache.js";
export * from "./commands/settings.js";
export * from "./commands/keybindings.js";
export * from "./commands/bridge.js";
export * from "./commands/language.js";
export * from "./commands/registry.js";
export * from "./commands/jsonSchema.js";
