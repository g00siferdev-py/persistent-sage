import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    let url = new URL(`../src/${rel}`, import.meta.url);
    const path = fileURLToPath(url);
    if (!existsSync(path) && existsSync(`${path}.ts`)) {
      url = new URL(`../src/${rel}.ts`, import.meta.url);
    }
    return nextResolve(url.href, context);
  }
  return nextResolve(specifier, context);
}
