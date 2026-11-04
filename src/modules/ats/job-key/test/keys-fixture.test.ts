import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { ATS } from "@/modules/ats/types";

import { classifyATS } from "../../classify";
import { getJobKey } from "..";

function everyAts<const T extends readonly ATS[]>(
  names: Exclude<ATS, T[number]> extends never ? T : never
): T {
  return names;
}

const ATS_NAMES = everyAts([
  "ashby",
  "bamboohr",
  "eightfold",
  "greenhouse",
  "icims",
  "jazzhr",
  "lever",
  "oraclecloud",
  "phenom",
  "pinpoint",
  "radancy",
  "rippling",
  "smartrecruiters",
  "successfactors",
  "workday",
  "custom",
  "none",
]);

interface FixtureRow {
  stratum: string;
  ats: string;
  url: string;
  key: string;
}

const rows: FixtureRow[] = readFileSync(path.join(import.meta.dirname, "fixtures/keys.tsv"), "utf-8")
  .split("\n")
  .filter((line) => line && !line.startsWith("#"))
  .slice(1)
  .map((line) => {
    const [stratum, ats, url, key] = line.split("\t");
    return { stratum, ats, url, key };
  });

function classify(url: string) {
  try {
    return classifyATS(new URL(url));
  } catch {
    return "invalid";
  }
}

function inStratum(stratum: string) {
  return rows.filter((row) => row.stratum === stratum);
}

describe("job key golden fixture", () => {
  it("matches every fixture key and ATS", () => {
    const mismatches = rows
      .map((row) => ({ ...row, actualAts: classify(row.url), actualKey: getJobKey(row.url) }))
      .filter((row) => row.actualAts !== row.ats || row.actualKey !== row.key);

    expect(mismatches).toEqual([]);
  });

  it("gives distinct URLs distinct keys", () => {
    expect(new Set(rows.map((row) => row.url)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it("covers every ATS", () => {
    const covered = new Set(rows.map((row) => row.ats));

    for (const ats of ATS_NAMES) {
      expect(covered, ats).toContain(ats);
    }
  });

  it("covers all myworkdaysite recruiting URLs", () => {
    const urls = inStratum("myworkdaysite");

    expect(urls).toHaveLength(41);
    for (const { url, ats } of urls) {
      expect(new URL(url).hostname).toMatch(/\.myworkdaysite\.com$/);
      expect(new URL(url).pathname).toMatch(/^\/(?:[a-z]{2}-[A-Z]{2}\/)?recruiting\//);
      expect(ats).toBe("workday");
    }
  });

  it("covers all career-site alias URLs", () => {
    const urls = inStratum("alias");

    expect(urls).toHaveLength(9);
    for (const { ats } of urls) {
      expect(ats).toBe("none");
    }
  });
});
