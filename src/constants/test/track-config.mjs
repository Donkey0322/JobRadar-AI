import { registerHooks } from "node:module";

const parents = new Map();

function chain(url) {
  const steps = [];
  const seen = new Set();
  let cursor = url;

  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    steps.push(cursor);
    cursor = parents.get(cursor);
  }

  return steps;
}

function tracksConfig(url) {
  return url.endsWith("/config.json") || url.endsWith("/src/constants/index.ts");
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    const finish = (result) => {
      if (context.parentURL) parents.set(result.url, context.parentURL);
      if (tracksConfig(result.url)) {
        throw new Error(`config load\n${chain(result.url).join("\n")}`);
      }
      return result;
    };

    if (resolved && typeof resolved.then === "function") return resolved.then(finish);
    return finish(resolved);
  },
});
