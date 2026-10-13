// Lets Node run the site's TypeScript (lib/*.ts) outside Next.js: Node strips the types itself, and
// this resolves the extensionless relative imports the site writes (`./api` to `./api.ts`).
//
//   node --import ./scripts/ts-resolve.mjs scripts/ask-index.ts
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.\.?\//.test(specifier) || /\.\w+$/.test(specifier)) {
        throw error;
      }
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
