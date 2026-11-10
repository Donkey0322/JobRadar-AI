import { describe, expect, it } from "vitest";

import { cursorCareerJobUrl, parseCursorCareerSlugs } from "../cursor-careers";

import { getJobKey } from "@/modules/ats/job-key";

const NEW_GRAD_ID = "164e27cd-289e-4bcd-8aaf-5280e75c5ed6";
const OTHER_ID = "d06d229f-eb2c-46d7-8e0f-96da5ecaec88";

describe("Cursor career slugs", () => {
  it("reads the escaped id and slug embedded on cursor.com/careers", () => {
    const html = [
      `\\"id\\":\\"${OTHER_ID}\\",\\"title\\":\\"Account Executive\\"`,
      `\\"urlSlug\\":\\"account-executive\\"`,
      `\\"id\\":\\"${NEW_GRAD_ID}\\",\\"title\\":\\"Software Engineer, New Grad 2027\\"`,
      `\\"urlSlug\\":\\"software-engineer-new-grad-2027\\"`,
    ].join(",");

    expect(parseCursorCareerSlugs(html).get(NEW_GRAD_ID)).toBe("software-engineer-new-grad-2027");
    expect(parseCursorCareerSlugs(html).get(OTHER_ID)).toBe("account-executive");
  });

  it("does not borrow the next posting's slug when one id has none", () => {
    const html = [
      `\\"id\\":\\"${OTHER_ID}\\",\\"title\\":\\"Missing slug\\"}`,
      `{\\"id\\":\\"${NEW_GRAD_ID}\\",\\"title\\":\\"Software Engineer, New Grad 2027\\"`,
      `\\"urlSlug\\":\\"software-engineer-new-grad-2027\\"`,
    ].join(",");

    const slugs = parseCursorCareerSlugs(html);

    expect(slugs.has(OTHER_ID)).toBe(false);
    expect(slugs.get(NEW_GRAD_ID)).toBe("software-engineer-new-grad-2027");
  });

  it("reads an unescaped id and slug", () => {
    const html = `{"id":"${NEW_GRAD_ID}","title":"Software Engineer, New Grad 2027","urlSlug":"software-engineer-new-grad-2027"}`;

    expect(parseCursorCareerSlugs(html).get(NEW_GRAD_ID)).toBe("software-engineer-new-grad-2027");
  });

  it("keeps the Ashby job id on the public careers link", () => {
    const link = cursorCareerJobUrl("software-engineer-new-grad-2027", NEW_GRAD_ID);

    expect(link).toBe(
      `https://cursor.com/careers/software-engineer-new-grad-2027?ashby_jid=${NEW_GRAD_ID}`
    );
    expect(getJobKey(link)).toBe(`ashby:${NEW_GRAD_ID}`);
  });
});
