import { ESLint } from "eslint";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function restricted(file: string, code: string) {
  return lint(file, code).then((messages) =>
    messages
      .filter((message) => message.ruleId === "@typescript-eslint/no-restricted-imports")
      .map((message) => message.message)
  );
}

async function lint(file: string, code: string) {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(`${code}\n`, { filePath: path.join(ROOT, file) });
  return result?.messages ?? [];
}

describe("import aliases", () => {
  it("resolves @/, @scripts, and @github in every vitest config", () => {
    const script = `
      import { createRequire } from "node:module";
      import { pathToFileURL } from "node:url";
      const require = createRequire(${JSON.stringify(import.meta.resolve("vitest"))});
      const { createServer } = await import(require.resolve("vite"));
      const root = ${JSON.stringify(ROOT)};
      const specs = [
        ["@/constants/log.ts", "src/constants/log.ts"],
        ["@scripts/github/summary.ts", "scripts/github/summary.ts"],
        ["@github/scripts/summary.mjs", ".github/scripts/summary.mjs"],
      ];
      const configFiles = ["vitest.config.mjs", "vitest.integration.config.mjs", "vitest.eval.config.mjs"];
      const configs = [];
      for (const file of configFiles) {
        const loaded = await import(pathToFileURL(root + "/" + file).href);
        configs.push([file, loaded.default.resolve.alias]);
      }
      const resolved = {};
      for (const [name, alias] of configs) {
        const server = await createServer({
          configFile: false,
          logLevel: "silent",
          root,
          appType: "custom",
          server: { middlewareMode: true, hmr: false },
          optimizeDeps: { noDiscovery: true },
          resolve: { alias },
        });
        try {
          resolved[name] = {};
          for (const [specifier, expected] of specs) {
            const result = await server.pluginContainer.resolveId(
              specifier,
              root + "/scripts/github/test/workflows.test.ts"
            );
            resolved[name][specifier] = result && result.id.endsWith(expected);
          }
        } finally {
          await server.close();
        }
      }
      process.stdout.write(JSON.stringify(resolved));
    `;

    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: ROOT,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      "vitest.config.mjs": {
        "@/constants/log.ts": true,
        "@scripts/github/summary.ts": true,
        "@github/scripts/summary.mjs": true,
      },
      "vitest.integration.config.mjs": {
        "@/constants/log.ts": true,
        "@scripts/github/summary.ts": true,
        "@github/scripts/summary.mjs": true,
      },
      "vitest.eval.config.mjs": {
        "@/constants/log.ts": true,
        "@scripts/github/summary.ts": true,
        "@github/scripts/summary.mjs": true,
      },
    });
  });

  it("lets tsx resolve the aliases without a network request", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jobradar-alias-"));
    temps.push(dir);
    const file = path.join(dir, "alias.ts");
    writeFileSync(
      file,
      [
        'import { RED_CROSS } from "@/constants/log";',
        'import { renderMarkdown } from "@github/scripts/summary.mjs";',
        'import { recordStage } from "@scripts/github/summary";',
        'console.log([typeof recordStage, typeof renderMarkdown, RED_CROSS.includes("\\u2717")].join(" "));',
        "",
      ].join("\n")
    );

    const result = spawnSync(
      path.join(ROOT, "node_modules/.bin/tsx"),
      ["--tsconfig", path.join(ROOT, "tsconfig.json"), file],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("function function true");
  });

  it("runs .github scripts with node and their own relative imports", () => {
    const summary = path.join(ROOT, ".github/scripts/summary.mjs");
    const route = path.join(ROOT, ".github/scripts/workflow-route.mjs");
    const env = { PATH: process.env.PATH ?? "" };

    const cli = spawnSync(process.execPath, [summary], { cwd: ROOT, encoding: "utf8", env });
    expect(cli.status).toBe(0);
    expect(cli.stderr).toContain("The task result is unchanged");

    const imported = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(route).href)})`],
      { cwd: ROOT, encoding: "utf8", env }
    );
    expect(imported.status, imported.stderr).toBe(0);
  });

  it("keeps the scripts and .github bans in later eslint blocks", async () => {
    const exception = await restricted(
      "src/utils/ai/index.ts",
      [
        'import { recordStage } from "@scripts/github/summary";',
        'import type { renderMarkdown } from "@github/scripts/summary.mjs";',
        'import dedup from "../../../scripts/command/job/dedup";',
        'import route from "../../../.github/scripts/workflow-route.mjs";',
        "export const values = { recordStage, dedup, route };",
        "export type Render = typeof renderMarkdown;",
      ].join("\n")
    );
    expect(exception.join("\n")).toContain("src must not import scripts");
    expect(exception.join("\n")).toContain("src must not import .github");
    expect(exception.some((message) => message.includes("@scripts/github/summary"))).toBe(true);
    expect(exception.some((message) => message.includes("@github/scripts/summary.mjs"))).toBe(true);
    expect(exception.some((message) => message.includes("../../../scripts/command/job/dedup"))).toBe(true);
    expect(exception.some((message) => message.includes("../../../.github/scripts/workflow-route.mjs"))).toBe(
      true
    );

    const logAllowed = await restricted(
      "src/utils/ai/provider/openai.ts",
      'import { RED_CROSS } from "@/constants/log";\nexport const mark = RED_CROSS;'
    );
    expect(logAllowed).toEqual([]);

    const otherConstant = await restricted(
      "src/utils/ai/provider/openai.ts",
      'import { COUNTRIES } from "@/constants/country";\nexport const countries = COUNTRIES;'
    );
    expect(otherConstant.join("\n")).toContain("utils must not import constants other than constants/log");

    const utils = await restricted(
      "src/utils/text.ts",
      [
        'import { renderMarkdown } from "@github/scripts/summary.mjs";',
        'import { RED_CROSS } from "@/constants/log";',
        "export const values = { renderMarkdown, RED_CROSS };",
      ].join("\n")
    );
    expect(utils.join("\n")).toContain("src must not import .github");
    expect(utils.join("\n")).toContain("utils must not import constants");

    const posting = await restricted(
      "src/modules/posting/posting.ts",
      [
        'import type { recordStage } from "@scripts/github/summary";',
        'import { Board } from "@/modules/employer/employer";',
        "export const board = Board;",
        "export type Stage = typeof recordStage;",
      ].join("\n")
    );
    expect(posting.join("\n")).toContain("src must not import scripts");
    expect(posting.join("\n")).toContain("posting must not import employer");
  });
});
