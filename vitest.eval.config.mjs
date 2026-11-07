import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.eval.test.ts"],
    testTimeout: 60_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@scripts": path.resolve(import.meta.dirname, "./scripts"),
      "@github": path.resolve(import.meta.dirname, "./.github"),
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
