import { describe, expect, it } from "vitest";

import { createIssueSectionParser } from "./github-issue";

const body = `### Name
<!-- generated guidance -->
Acme
ignored second line

### Keywords
TypeScript
<!-- hidden -->

Remote

### Targets
- [x] Internship
- [X] Entry level
- [ ] Senior

### Enabled
TRUE

### Port
587

### Empty
_No response_
`;

describe("createIssueSectionParser", () => {
  it("parses scalar, lines, checkboxes, booleans, and numbers without comments", () => {
    const issue = createIssueSectionParser(body);

    expect(issue.section("Name")).toBe("Acme\nignored second line");
    expect(issue.scalar("Name")).toBe("Acme");
    expect(issue.lines("Keywords")).toEqual(["TypeScript", "Remote"]);
    expect(issue.checkboxes("Targets")).toEqual(["Internship", "Entry level"]);
    expect(issue.checkboxEnabled("Targets", "Internship")).toBe(true);
    expect(issue.boolean("Enabled")).toBe(true);
    expect(issue.number("Port")).toBe(587);
  });

  it("treats no-response and missing required sections as empty", () => {
    const issue = createIssueSectionParser(body);

    expect(issue.scalar("Empty")).toBe("");
    expect(() => issue.required("Empty")).toThrow("Missing required field: Empty");
    expect(() => issue.required("Missing", "custom error")).toThrow("custom error");
  });

  it("supports explicit case-insensitive headings while defaulting to case-sensitive", () => {
    expect(createIssueSectionParser(body).scalar("name")).toBe("");
    expect(createIssueSectionParser(body, { caseSensitive: false }).scalar("name")).toBe("Acme");
  });

  it("rejects invalid boolean and number values", () => {
    const issue = createIssueSectionParser(`### Flag\nmaybe\n### Count\nmany`);

    expect(() => issue.boolean("Flag")).toThrow("Invalid boolean value for Flag: maybe");
    expect(() => issue.number("Count")).toThrow("Invalid number value for Count: many");
  });
});
