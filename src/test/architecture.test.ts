import { describe, expect, it } from "vitest";

import { scanArchitecture, violationKey } from "./architecture";
import { architectureExceptions } from "./architecture.exceptions";

const scan = scanArchitecture();

function added(extra: Record<string, string>) {
  const known = new Set(architectureExceptions.map(violationKey));
  return scanArchitecture(extra).violations.filter((item) => !known.has(violationKey(item)));
}

describe("architecture boundaries", () => {
  it("matches the current exception list exactly", () => {
    expect(scan.violations).toEqual(architectureExceptions);
  });

  it("allows a downward runtime edge and a type-only import", () => {
    expect(scan.edges).toContainEqual({
      from: "src/modules/employer/listing/custom/amazon.ts",
      to: "src/modules/posting/posting.ts",
      kind: "runtime",
    });
    expect(scan.edges).toContainEqual({
      from: "src/types/company.ts",
      to: "src/modules/ats/types.ts",
      kind: "type",
    });
    expect(scan.edges).toContainEqual({
      from: "src/modules/posting/jd/registry.ts",
      to: "src/modules/ats/types.ts",
      kind: "type",
    });
    expect(scan.violations.some((item) => item.kind === "type")).toBe(false);

    expect(
      added({
        "src/modules/employer/__architecture_probe.ts":
          'import { Posting } from "@/modules/posting/posting";\nimport { cleanText } from "@/utils/text";\n',
        "src/types/__architecture_probe.ts":
          'import type { ATS } from "@/modules/ats/types";\n',
        "src/modules/posting/__architecture_probe.ts":
          'import type { ATS } from "@/modules/ats/types";\n',
      })
    ).toEqual([]);
  });

  it("rejects a new alias import and a new relative import", () => {
    expect(
      added({
        "src/utils/__architecture_probe.ts": [
          'import type { ATS } from "@/modules/ats/types";',
          'import { classifyATS } from "@/modules/ats/classify";',
          "",
        ].join("\n"),
      })
    ).toEqual([
      {
        rule: "utils must not import modules",
        from: "src/utils/__architecture_probe.ts",
        to: "src/modules/ats/classify.ts",
        kind: "runtime",
      },
    ]);

    expect(
      added({
        "src/utils/__architecture_probe.ts":
          'import { classifyATS } from "../modules/ats/classify";\n',
      })
    ).toEqual([
      {
        rule: "utils must not import modules",
        from: "src/utils/__architecture_probe.ts",
        to: "src/modules/ats/classify.ts",
        kind: "runtime",
      },
    ]);
  });

  it("rejects another edge in a directory pair that already has an exception", () => {
    expect(architectureExceptions.some((item) => item.rule === "utils must not import modules")).toBe(
      false
    );
    expect(
      architectureExceptions.some(
        (item) => item.from.startsWith("src/utils/ai/") && item.to.startsWith("src/constants/")
      )
    ).toBe(true);

    expect(
      added({
        "src/utils/ai/__architecture_probe.ts": 'import { COUNTRIES } from "@/constants/country";\n',
      })
    ).toEqual([
      {
        rule: "utils must not import constants",
        from: "src/utils/ai/__architecture_probe.ts",
        to: "src/constants/country.ts",
        kind: "runtime",
      },
    ]);
  });

  it("follows a barrel re-export to the defining file", () => {
    expect(
      added({
        "src/utils/__architecture_probe.ts":
          'import { CUSTOM_COMPANY_DOMAINS } from "@/modules/employer/listing";\n',
      }).map((item) => item.to)
    ).toEqual([
      "src/modules/ats/custom/index.ts",
      "src/modules/employer/listing/index.ts",
    ]);

    const barrel = added({
      "src/utils/__architecture_barrel.ts":
        'export { classifyATS } from "@/modules/ats/classify";\n',
      "src/utils/__architecture_consumer.ts":
        'import { classifyATS } from "./__architecture_barrel";\n',
    });
    expect(barrel).toEqual([
      {
        rule: "utils must not import modules",
        from: "src/utils/__architecture_barrel.ts",
        to: "src/modules/ats/classify.ts",
        kind: "runtime",
      },
      {
        rule: "utils must not import modules",
        from: "src/utils/__architecture_consumer.ts",
        to: "src/modules/ats/classify.ts",
        kind: "runtime",
      },
    ]);
  });

  it("rejects src importing scripts, including a type-only import", () => {
    expect(scan.violations.some((item) => item.rule === "src must not import scripts")).toBe(false);
    expect(scan.edges).toContainEqual({
      from: "scripts/command/index.ts",
      to: "scripts/command/setup/checkConfig.ts",
      kind: "runtime",
    });

    expect(
      added({
        "src/utils/__architecture_probe.ts": 'import "../../scripts/dedup";\n',
        "src/types/__architecture_probe.ts": 'import type { X } from "../../scripts/dedup";\n',
      }).map((item) => `${item.kind} ${item.from}`)
    ).toEqual([
      "runtime src/utils/__architecture_probe.ts",
      "type src/types/__architecture_probe.ts",
    ]);
  });

  it("does not treat vi.mock or a non-literal import() as an edge", () => {
    const kinds = new Set(scan.unrecognized.map((item) => item.kind));
    expect(kinds).toEqual(new Set(["vi.mock", "dynamic import()"]));
    expect(scan.unrecognized.filter((item) => item.kind === "dynamic import()")).toEqual([
      {
        kind: "dynamic import()",
        file: "scripts/test/ai-entry.test.ts",
        detail: "non-literal",
        rule: null,
      },
    ]);
    expect(scan.unrecognized.filter((item) => item.rule)).toEqual([]);
    expect(scan.unrecognized).toContainEqual({
      kind: "vi.mock",
      file: "src/utils/ai/test/enabled.test.ts",
      detail: "@/config",
      rule: null,
    });

    expect(
      added({
        "src/utils/__architecture_probe.ts":
          'vi.mock("@/modules/ats/classify");\nexport async function load(name: string) {\n  return import(name);\n}\n',
      })
    ).toEqual([]);
  });
});
