import type { Company } from "../../type";

export async function fetchMeta() {
  const url = "https://www.metacareers.com/graphql";

  const variables = {
    search_input: {
      q: null,
      divisions: [],
      offices: [],
      roles: [],
      leadership_levels: [],
      saved_jobs: [],
      saved_searches: [],
      sub_teams: [],
      teams: [],
      is_leadership: false,
      is_remote_only: false,
      sort_by_new: true,
      results_per_page: null,
    },
    viewasUserID: null,
    isLoggedIn: false,
  };

  const body = new URLSearchParams({
    __a: "1",
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "CareersJobSearchResultsDataQuery",
    server_timestamps: "true",
    variables: JSON.stringify(variables),
    doc_id: "27506805582236862",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0",
    },
    body,
  });

  const text = await res.text();

  // Meta 有時候 response 前面會有 for (;;);
  const cleaned = text.replace(/^for\s*\(;;\);/, "");
  console.log(cleaned);
  //   return JSON.parse(cleaned);
}

export async function fetchMetaJobs() {
  const url = "https://www.metacareers.com/graphql";

  const variables = {
    search_input: {
      q: null,
      divisions: [],
      offices: [],
      roles: [],
      leadership_levels: [],
      saved_jobs: [],
      saved_searches: [],
      sub_teams: [],
      teams: [],
      is_leadership: false,
      is_remote_only: false,
      sort_by_new: true,
      results_per_page: null,
    },
    viewasUserID: null,
    isLoggedIn: false,
  };

  const body = new URLSearchParams({
    av: "0",
    __user: "0",
    __a: "1",
    __req: "3",
    __comet_req: "31",

    lsd: "AdQRZLdJCOhj0EbJl8elDkmFybU",
    jazoest: "26510081829076100746779104106486998741085610110868107109701219885",

    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "CareersJobSearchResultsDataQuery",
    server_timestamps: "true",
    variables: JSON.stringify(variables),
    doc_id: "27506805582236862",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0",
      "x-fb-lsd": "AdQteMgsd4yzEtoCLSSnLjj2iHU",
      "x-asbd-id": "359341",
      referer: "https://www.metacareers.com/jobsearch",
      origin: "https://www.metacareers.com",
    },
    body,
  });

  const raw = await res.text();

  if (raw.startsWith("<!DOCTYPE") || raw.startsWith("<?xml")) {
    throw new Error("Meta returned HTML error page. Request params/headers are still incomplete.");
  }

  const cleaned = raw.replace(/^for\s*\(;;\);/, "");
  return JSON.parse(cleaned);
}

const META_CAREERS_URL = "https://www.metacareers.com/jobsearch";
const META_GRAPHQL_URL = "https://www.metacareers.com/graphql";

function extractLsd(html: string) {
  const patterns = [
    /"LSD",\[\],\{"token":"([^"]+)"/,
    /"token":"([^"]+)","async_get_token"/,
    /name="lsd"\s+value="([^"]+)"/,
    /\["LSD",\[\],\{"token":"([^"]+)"/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function buildJazoest(lsd: string) {
  return `2${Array.from(lsd)
    .map((char) => char.charCodeAt(0))
    .join("")}`;
}

async function getMetaTokens() {
  const res = await fetch(META_CAREERS_URL, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  const html = await res.text();

  if (!res.ok) {
    throw new Error(`Failed to GET Meta Careers: ${res.status}`);
  }

  const lsd = extractLsd(html);

  if (!lsd) {
    throw new Error("Failed to extract lsd token from Meta Careers HTML");
  }

  return {
    lsd,
    jazoest: buildJazoest(lsd),
  };
}

const token = await getMetaTokens();
console.log(token);
const jobs = await fetchMetaJobs();
console.log(jobs.data.job_search_with_featured_jobs.all_jobs.length);
