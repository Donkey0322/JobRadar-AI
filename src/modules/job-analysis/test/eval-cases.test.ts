import { describe, expect, it } from "vitest";

import { JD_EVAL_CASES } from "./eval-cases";

import { JDResponseSchema } from "@/validation/ai";

const expectedSchema = JDResponseSchema.pick({
  citizenship: true,
  sponsorship: true,
  country: true,
  category: true,
  season: true,
});

describe("JD eval cases", () => {
  it("have unique names", () => {
    const names = JD_EVAL_CASES.map((testCase) => testCase.name);
    expect(names).toEqual([...new Set(names)]);
  });

  it.each(JD_EVAL_CASES)("$name has a schema-valid expected result", ({ expected }) => {
    const { locationIncludes: _location, ...fields } = expected;
    expect(expectedSchema.parse(fields)).toEqual(fields);
  });
});
