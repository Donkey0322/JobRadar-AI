import { describe, expect, it } from "vitest";

import { Posting } from "../posting";

function makePosting(dates: string[] = []) {
  return Posting.from(
    {
      company: "Acme",
      role: "Software Engineer Intern",
      link: "https://job-boards.greenhouse.io/acme/jobs/123",
      location: "Remote",
    },
    dates
  );
}

describe("Posting", () => {
  it("keeps runtime behavior out of persisted job data", () => {
    const posting = makePosting([new Date().toISOString()]);

    expect(posting.toJob()).toEqual({
      company: "Acme",
      role: "Software Engineer Intern",
      link: "https://job-boards.greenhouse.io/acme/jobs/123",
      location: "Remote",
    });
    expect(JSON.parse(JSON.stringify(posting))).toEqual(posting.toJob());
  });

  it("uses normalized job identity for known checks", () => {
    const posting = makePosting();

    expect(posting.isTarget()).toBe(true);
    expect(posting.isKnown(new Set([posting.key()]))).toBe(true);
    expect(posting.isKnown(new Set())).toBe(false);
  });

  it("accepts a posting when any listing date is recent", () => {
    const posting = makePosting(["2000-01-01", new Date().toISOString()]);

    expect(posting.isRecent()).toBe(true);
  });

  it("returns the same runtime instance when wrapping a Posting again", () => {
    const posting = makePosting();

    expect(Posting.from(posting)).toBe(posting);
  });
});
