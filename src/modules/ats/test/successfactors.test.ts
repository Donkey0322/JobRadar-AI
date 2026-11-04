import { describe, expect, it } from "vitest";

import {
  cleanSuccessFactorsLink,
  getSuccessFactorsFeedCompanyName,
  getSuccessFactorsFeedUrl,
  getSuccessFactorsJobId,
  isSuccessFactorsUrl,
  parseSuccessFactorsFeed,
  splitSuccessFactorsTitle,
  successFactorsCompanyName,
} from "../successfactors";

const FEED = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version='2.0'><channel>
  <title>Qorvo - Custom Search</title>
  <description>Custom RSS Feed for Qorvo</description>
  <item>
    <title><![CDATA[Software Engineer Intern (Richardson, TX, US, 75080)]]></title>
    <description><![CDATA[<p>Job Description</p>]]></description>
    <pubDate>Mon, 02 Nov 2026 8:00:00 GMT</pubDate>
    <link>https://careers.qorvo.com/job/Richardson-Software-Engineer-Intern-TX-75080/1435014200/?feedId=null&amp;utm_source=J2WRSS&amp;utm_medium=rss</link>
  </item>
  <item>
    <title><![CDATA[Associate, Procurement (Huntsville, AL) (Huntsville, AL, US, 35806)]]></title>
    <pubDate>Sun, 01 Nov 2026 8:00:00 GMT</pubDate>
    <link>https://careers.qorvo.com/job/Huntsville-Associate-Procurement-AL-35806/1435014300/</link>
  </item>
  <item>
    <title><![CDATA[Duplicate (Richardson, TX, US, 75080)]]></title>
    <pubDate>Mon, 02 Nov 2026 8:00:00 GMT</pubDate>
    <link>https://careers.qorvo.com/job/Richardson-Software-Engineer-Intern-TX-75080/1435014200/</link>
  </item>
  <item>
    <title><![CDATA[Not a job page]]></title>
    <link>https://careers.qorvo.com/content/about/</link>
  </item>
</channel></rss>`;

describe("SuccessFactors URL classification", () => {
  it.each([
    "https://aramarkcareers.com/UnitedStates/job/West-Allis-Food-Service-Worker-WI-53227/1441993400/",
    "https://careers.qorvo.com/job/Richardson-Software-Engineer-TX-75080/1435014200/",
    "https://careers.dovercorporation.com/job/Keene-Software-Engineer-NH-03431/1404722033",
    "https://assaabloy.jobs2web.com/search/",
    "https://careers.example.com/anything?ats=successfactors",
  ])("recognizes %s", (url) => {
    expect(isSuccessFactorsUrl(new URL(url))).toBe(true);
  });

  it.each([
    "https://careers.example.com/job/1",
    "https://careers.arm.com/job/bengaluru/ip-verification-engineer/33099/99500560928",
    "https://careers.example.com/us/en/job/123456/software-engineer",
    "https://careers.example.com/a/b/job/software-engineer/1234567/",
  ])("rejects %s", (url) => {
    expect(isSuccessFactorsUrl(new URL(url))).toBe(false);
  });
});

describe("SuccessFactors URL helpers", () => {
  it("reads the job id and builds the RSS feed URL", () => {
    const url = new URL(
      "https://aramarkcareers.com/UnitedStates/job/West-Allis-Food-Service-Worker-WI-53227/1441993400/"
    );

    expect(getSuccessFactorsJobId(url.pathname)).toBe("1441993400");
    expect(getSuccessFactorsFeedUrl(url)).toBe(
      "https://aramarkcareers.com/services/rss/job/?locale=en_US"
    );
  });

  it("drops the feed tracking query from job links", () => {
    expect(
      cleanSuccessFactorsLink(
        "https://careers.qorvo.com/job/Richardson-Engineer-TX-75080/1435014200/?feedId=null&utm_source=J2WRSS"
      )
    ).toBe("https://careers.qorvo.com/job/Richardson-Engineer-TX-75080/1435014200/");
  });
});

describe("SuccessFactors feed parsing", () => {
  it("splits the trailing location off the title", () => {
    expect(splitSuccessFactorsTitle("Software Engineer (Richardson, TX, US, 75080)")).toEqual({
      title: "Software Engineer",
      location: "Richardson, TX, US, 75080",
    });
    expect(splitSuccessFactorsTitle("Software Engineer (Remote)")).toEqual({
      title: "Software Engineer (Remote)",
      location: "",
    });
  });

  it("parses feed items into deduplicated jobs", () => {
    expect(parseSuccessFactorsFeed(FEED)).toEqual([
      {
        jobId: "1435014200",
        title: "Software Engineer Intern",
        link: "https://careers.qorvo.com/job/Richardson-Software-Engineer-Intern-TX-75080/1435014200/",
        location: "Richardson, TX, US, 75080",
        postedDate: "Mon, 02 Nov 2026 8:00:00 GMT",
      },
      {
        jobId: "1435014300",
        title: "Associate, Procurement (Huntsville, AL)",
        link: "https://careers.qorvo.com/job/Huntsville-Associate-Procurement-AL-35806/1435014300/",
        location: "Huntsville, AL, US, 35806",
        postedDate: "Sun, 01 Nov 2026 8:00:00 GMT",
      },
    ]);
  });

  it("names the company from the feed, with host overrides", () => {
    expect(getSuccessFactorsFeedCompanyName(FEED)).toBe("Qorvo");
    expect(getSuccessFactorsFeedCompanyName("<rss><channel></channel></rss>")).toBeNull();

    expect(successFactorsCompanyName("Qorvo", new URL("https://careers.qorvo.com/"))).toBe("Qorvo");
    expect(successFactorsCompanyName("L3HHCM20", new URL("https://jobs.l3harris.com/"))).toBe(
      "L3Harris"
    );
    expect(successFactorsCompanyName(null, new URL("https://www.mhicareers.com/"))).toBe(
      "mhicareers.com"
    );
  });
});
