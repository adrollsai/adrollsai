/**
 * Module resolution hooks so plain `node` can load the app's TypeScript sources.
 *
 * Node 24 strips types natively, but its ESM resolver is strict about
 * specifiers: `./runner` and `@/utils/r2` do not resolve, so a self-test that
 * wants to exercise a real module would be limited to files that happen to have
 * no imports at all. These hooks add the two things the repo's source already
 * relies on (extensionless relative imports and the `@/*` tsconfig path alias)
 * without touching a single source file and without adding a dependency.
 *
 * Usage, before the first import of a .ts file:
 *
 *   import { register } from 'node:module';
 *   register('./ts-resolve-hooks.mjs', import.meta.url);
 *
 * Only resolution is hooked; loading still goes through Node's own TypeScript
 * type-stripping, so no build step is involved.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js'];

function isFile(p) {
  try {
    return existsSync(p) && !p.endsWith(path.sep);
  } catch {
    return false;
  }
}

/** Try `<base><suffix>` for every suffix the bundler would have tried. */
function withSuffix(base) {
  if (path.extname(base) && isFile(base)) return base;
  for (const suffix of CANDIDATE_SUFFIXES) {
    if (isFile(base + suffix)) return base + suffix;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // tsconfig `paths`: `@/*` -> repo root
  if (specifier.startsWith('@/')) {
    const hit = withSuffix(path.join(ROOT, specifier.slice(2)));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }

  // extensionless relative / absolute imports inside a .ts file
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const hit = withSuffix(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
