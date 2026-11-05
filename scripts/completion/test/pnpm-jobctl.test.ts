import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { completePnpm } from "../pnpm-jobctl";

const packageText = readFileSync("package.json", "utf8");

function names(tokens: string[]) {
  return completePnpm(packageText, tokens).flatMap((item) =>
    Array.isArray(item.name) ? item.name : [item.name]
  );
}

describe("pnpm jobctl completion draft", () => {
  it("offers jobctl among the package scripts", () => {
    expect(names(["pnpm", ""])).toContain("jobctl");
  });

  it("opens the command tree after pnpm jobctl", () => {
    expect(names(["pnpm", "jobctl", ""])).toEqual([
      "scan",
      "sync",
      "batch",
      "notify",
      "setup",
      "job",
      "company",
      "board",
      "email",
    ]);
  });

  it("opens job, company, board, and the requested flags", () => {
    expect(names(["pnpm", "jobctl", "job", ""])).toEqual([
      "add",
      "analyze",
      "delete",
      "clean",
      "dedup",
    ]);
    expect(names(["pnpm", "jobctl", "job", "add", ""])).toEqual(["-l", "--link", "-f", "--file"]);
    expect(names(["pnpm", "jobctl", "company", ""])).toEqual(["refresh"]);
    expect(names(["pnpm", "jobctl", "board", ""])).toEqual(["refresh"]);
    expect(names(["pnpm", "jobctl", "batch", ""])).toEqual(["--submit-only"]);
  });
});
