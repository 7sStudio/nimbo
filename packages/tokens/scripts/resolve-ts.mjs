// Lets plain Node run the generator against the package's TypeScript sources: a relative `.js` specifier resolves to the `.ts` beside it.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
      const typescript = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
      if (existsSync(fileURLToPath(typescript))) return nextResolve(typescript.href, context);
    }
    return nextResolve(specifier, context);
  },
});
