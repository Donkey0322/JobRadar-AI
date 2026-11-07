import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/completion/test/**/*.integration.test.ts"],
  },
  resolve: {
    alias: {
      "@scripts": path.resolve(import.meta.dirname, "./scripts"),
      "@github": path.resolve(import.meta.dirname, "./.github"),
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
