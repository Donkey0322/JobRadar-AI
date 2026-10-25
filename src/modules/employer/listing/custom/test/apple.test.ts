import { describe, expect, it } from "vitest";

import { parseAppleJobs } from "../apple";

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

  it("reads a single office from the location column and ignores the accessibility label", () => {
    const html = `
      <ul id="search-job-list">
        <li>
          <a href="/en-us/details/200689475-2611/software-development-engineer-core-os">
            Software Development Engineer - Core OS
          </a>
          <div class="job-title-location">
            <span class="a11y">Location</span>
            <span id="search-store-name-container-1">Prague</span>
          </div>
          <span class="job-posted-date">Oct 20, 2026</span>
        </li>
        <li>
          <a href="/en-us/details/114438210/jp-technical-specialist">JP-Technical Specialist</a>
          <div class="job-title-location">
            <span class="a11y">Location</span>
            <span class="table--advanced-search__location-sub">Various Locations within Japan</span>
          </div>
          <span class="job-posted-date">Oct 25, 2026</span>
        </li>
      </ul>
    `;

    expect(parseAppleJobs(html).map((job) => job.location)).toEqual([
      "Prague",
      "Various Locations within Japan",
    ]);
  });
});
