import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { COUNTRIES } from "@/constants/country";
import { JOB_CATEGORIES, JobCategory } from "@/constants/job-category";
import { SEASON_VALUES, SEASONS } from "@/constants/season";

const root = path.resolve(import.meta.dirname, "../../..");
const node = process.execPath;
const hook = path.join(root, "src/constants/test/track-config.mjs");

function runProbe(script: string) {
  try {
    const stdout = execFileSync(
      node,
      ["--import", hook, "--import", "tsx", path.join(root, script)],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

describe("vocabulary modules", () => {
  it("keeps category, country, and season order", () => {
    expect(JOB_CATEGORIES).toEqual([
      JobCategory.SUMMER_INTERN,
      JobCategory.OFF_SEASON_INTERN,
      JobCategory.ENTRY_LEVEL,
      JobCategory.MID_LEVEL,
      JobCategory.SENIOR_LEVEL,
    ]);
    expect(JobCategory.SUMMER_INTERN).toBe("summer intern");
    expect(JobCategory.OFF_SEASON_INTERN).toBe("off-season intern");
    expect(JobCategory.ENTRY_LEVEL).toBe("entry level");
    expect(JobCategory.MID_LEVEL).toBe("mid level");
    expect(JobCategory.SENIOR_LEVEL).toBe("senior level");
    expect(COUNTRIES[0]).toBe("USA");
    expect(COUNTRIES.at(-1)).toBe("Other");
    expect(SEASON_VALUES).toEqual([
      SEASONS.summer,
      SEASONS.fall,
      SEASONS.spring,
      SEASONS.winter,
      SEASONS.none,
    ]);
    expect(SEASONS.none).toBe("None");
  });

  it("does not read or parse config.json", () => {
    const result = runProbe("src/constants/test/probe-vocabulary.ts");

    expect(result.stderr).not.toContain("config load");
    expect(result.stdout).toContain("vocabulary-ok");
    expect(result.status).toBe(0);
  });

  it("does not load config when evaluating @/types", () => {
    const result = runProbe("src/constants/test/probe-types.ts");

    expect(result.stderr).not.toContain("config load");
    expect(result.stdout).toContain("types-ok");
    expect(result.status).toBe(0);
  });
  it("detects a config load from the constants barrel", () => {
    const result = runProbe("src/constants/test/probe-config.ts");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("config load");
    expect(result.stderr).toMatch(/config\.json|src\/constants\/index\.ts/);
  });
});
