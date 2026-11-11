/**
 * Lets the script load server code outside Next.js. Import it before anything else.
 *
 * The ai and skill-map index files `import "server-only"`, which throws outside a React
 * Server Component build. The usual fix, `--conditions=react-server`, breaks this script:
 * the flashcards and quiz index files also export their screens, which load next/link,
 * and React's server build has no createContext. So only "server-only" is made a no-op,
 * as vitest.config.ts does.
 *
 * Node 22.15 and later have module.registerHooks, which resolves "server-only" with the
 * react-server condition (its own empty file). Older Node (20, early 22) has no
 * registerHooks, so an empty module is put in require's cache instead: tsx runs this repo
 * as CommonJS, so every `import "server-only"` becomes a require that finds it there.
 */
import * as nodeModule from "node:module";

export type ServerOnlyMethod = "hooks" | "require-cache";

type Hooks = { registerHooks?: typeof nodeModule.registerHooks };

export function allowServerOnly(hooks: Hooks, req: NodeJS.Require): ServerOnlyMethod {
  if (typeof hooks.registerHooks === "function") {
    hooks.registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier !== "server-only") return nextResolve(specifier, context);
        return nextResolve(specifier, { ...context, conditions: [...(context.conditions ?? []), "react-server"] });
      },
    });
    return "hooks";
  }

  const file = req.resolve("server-only");
  const empty = new nodeModule.Module(file);
  empty.filename = file;
  empty.loaded = true;
  empty.exports = {};
  req.cache[file] = empty;
  return "require-cache";
}

export function nodeTooOldSentence(version: string): string {
  return (
    `This script could not load the app's server code on Node ${version}. ` +
    "Run it on Node 22.15 or newer (for example `nvm use 22`), then try again."
  );
}

if (!process.env.VITEST) {
  try {
    allowServerOnly(nodeModule, nodeModule.createRequire(__filename));
  } catch {
    console.log(nodeTooOldSentence(process.version));
    process.exit(1);
  }
}
