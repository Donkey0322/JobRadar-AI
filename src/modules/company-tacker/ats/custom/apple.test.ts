import { describe, expect, it } from "vitest";

import { parseAppleJobs } from "./apple";

describe("parseAppleJobs", () => {
  it("normalizes whitespace in parsed text fields", () => {
    const postedAt = new Date().toISOString();
    const html = `
      <ul id="search-job-list">
        <li>
          <a href="/en-us/details/123/software-engineer">
            Software
            Engineer
          </a>
          <span class="table--advanced-search__location-sub">Cupertino   CA</span>
          <span class="job-posted-date">${postedAt}</span>
        </li>
      </ul>
    `;

    expect(parseAppleJobs(html)).toEqual([
      {
        title: "Software Engineer",
        link: "https://jobs.apple.com/en-us/details/123/software-engineer",
        location: "Cupertino CA",
        postedAt,
      },
    ]);
  });
});
