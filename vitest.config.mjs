import path from "node:path";
import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...defaultExclude, "**/*.eval.test.ts", "**/*.integration.test.ts"],
  },
  resolve: {
    alias: {
      // `@` matches `@/…` only. `@scripts` and `@github` stay separate prefixes.
      "@scripts": path.resolve(import.meta.dirname, "./scripts"),
      "@github": path.resolve(import.meta.dirname, "./.github"),
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
