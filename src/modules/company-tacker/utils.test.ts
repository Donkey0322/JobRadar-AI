import { describe, expect, it } from "vitest";

import { isTechEntryLevel, isTechIntern, isTechMidLevel, isTechSeniorLevel } from "./utils";

describe("isTechIntern", () => {
  it("detects tech interns", () => {
    expect(isTechIntern("Software Engineer Intern")).toBe(true);
    expect(isTechIntern("Frontend Intern")).toBe(true);
    expect(isTechIntern("Backend Engineering Internship")).toBe(true);
  });

  it("rejects non-tech interns", () => {
    expect(isTechIntern("Marketing Intern")).toBe(false);
    expect(isTechIntern("HR Internship")).toBe(false);
  });

  it("rejects full time roles", () => {
    expect(isTechIntern("Software Engineer")).toBe(false);
  });
});

describe("isTechEntryLevel", () => {
  it("accepts explicit entry level roles", () => {
    expect(isTechEntryLevel("Software Engineer I")).toBe(true);
    expect(isTechEntryLevel("Junior Backend Engineer")).toBe(true);
    expect(isTechEntryLevel("Entry Level Software Developer")).toBe(true);
    expect(isTechEntryLevel("New Grad SWE")).toBe(true);
  });

  it("accepts generic full time tech roles", () => {
    expect(isTechEntryLevel("Software Engineer")).toBe(true);
    expect(isTechEntryLevel("Frontend Developer")).toBe(true);
    expect(isTechEntryLevel("Platform Engineer")).toBe(true);
  });

  it("rejects mid level roles", () => {
    expect(isTechEntryLevel("Software Engineer II")).toBe(false);
    expect(isTechEntryLevel("Mid Level Backend Engineer")).toBe(false);
  });

  it("rejects senior roles", () => {
    expect(isTechEntryLevel("Software Engineer III")).toBe(false);
    expect(isTechEntryLevel("Senior Software Engineer")).toBe(false);
    expect(isTechEntryLevel("Sr. Spclst , Software Engineering")).toBe(false);
  });

  it("rejects interns", () => {
    expect(isTechEntryLevel("Software Engineer Intern")).toBe(false);
  });

  it("rejects non-tech roles", () => {
    expect(isTechEntryLevel("Sales Associate")).toBe(false);
  });
});

describe("isTechMidLevel", () => {
  it("accepts explicit mid level roles", () => {
    expect(isTechMidLevel("Software Engineer II")).toBe(true);
    expect(isTechMidLevel("Mid Level Backend Engineer")).toBe(true);
  });

  it("accepts generic full time tech roles", () => {
    expect(isTechMidLevel("Software Engineer")).toBe(true);
    expect(isTechMidLevel("Frontend Developer")).toBe(true);
  });

  it("rejects entry level roles", () => {
    expect(isTechMidLevel("Software Engineer I")).toBe(false);
    expect(isTechMidLevel("Junior Backend Engineer")).toBe(false);
  });

  it("rejects senior roles", () => {
    expect(isTechMidLevel("Software Engineer III")).toBe(false);
    expect(isTechMidLevel("Senior Software Engineer")).toBe(false);
    expect(isTechMidLevel("Sr. Spclst , Software Engineering")).toBe(false);
  });

  it("rejects interns", () => {
    expect(isTechMidLevel("Software Engineer Intern")).toBe(false);
  });
});

describe("isTechSeniorLevel", () => {
  it("accepts explicit senior roles", () => {
    expect(isTechSeniorLevel("Software Engineer III")).toBe(true);
    expect(isTechSeniorLevel("Senior Software Engineer")).toBe(true);
    expect(isTechSeniorLevel("Senior Platform Engineer")).toBe(true);
    expect(isTechSeniorLevel("Sr. Spclst , Software Engineering")).toBe(true);
  });

  it("accepts generic full time tech roles", () => {
    expect(isTechSeniorLevel("Software Engineer")).toBe(true);
    expect(isTechSeniorLevel("Frontend Developer")).toBe(true);
  });

  it("rejects entry level roles", () => {
    expect(isTechSeniorLevel("Software Engineer I")).toBe(false);
    expect(isTechSeniorLevel("Junior Backend Engineer")).toBe(false);
  });

  it("rejects mid level roles", () => {
    expect(isTechSeniorLevel("Software Engineer II")).toBe(false);
    expect(isTechSeniorLevel("Mid Level Backend Engineer")).toBe(false);
  });

  it("rejects interns", () => {
    expect(isTechSeniorLevel("Software Engineer Intern")).toBe(false);
  });
});
