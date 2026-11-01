import { describe, expect, it } from "vitest";

import { parseGreenhouse } from "../greenhouse";

describe("parseGreenhouse", () => {
  it("reads the board and job id from a Greenhouse job path", async () => {
    await expect(
      parseGreenhouse("https://job-boards.greenhouse.io/acme/jobs/6865704002")
    ).resolves.toEqual({
      company: "acme",
      jobId: "6865704002",
    });
  });
});
