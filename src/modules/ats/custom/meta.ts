export const META_CAREERS_URL = "https://www.metacareers.com/jobsearch";
const META_GRAPHQL_URL = "https://www.metacareers.com/api/graphql/";

/** Headers for the HTML pages a Meta session token is read from. */
export const META_PAGE_HEADERS = {
  "user-agent": "Mozilla/5.0",
  accept: "text/html",
};

export interface MetaSession {
  lsd: string;
  cookie: string;
  referer: string;
}

export interface MetaQuery {
  friendlyName: string;
  docId: string;
  variables: unknown;
}

export function extractLsd(html: string): string | null {
  const patterns = [
    /\["LSD",\[\],\{"token":"([^"]+)"\}/,
    /"LSD",\[\],\{"token":"([^"]+)"\}/,
    /name="lsd"\s+value="([^"]+)"/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function buildJazoest(lsd: string): string {
  return `2${Array.from(lsd)
    .map((char) => char.charCodeAt(0))
    .join("")}`;
}

export function cleanMetaJson(raw: string): string {
  return raw.replace(/^for\s*\(;;\);/, "");
}

/** Anonymous Relay request; callers read and judge the response. */
export function postMetaGraphql(
  session: MetaSession,
  query: MetaQuery,
  signal: AbortSignal
): Promise<Response> {
  const body = new URLSearchParams({
    av: "0",
    __user: "0",
    __a: "1",
    __req: "3",
    __comet_req: "31",
    lsd: session.lsd,
    jazoest: buildJazoest(session.lsd),
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: query.friendlyName,
    server_timestamps: "true",
    variables: JSON.stringify(query.variables),
    doc_id: query.docId,
  });

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    "user-agent": "Mozilla/5.0",
    "x-fb-lsd": session.lsd,
    "x-asbd-id": "359341",
    origin: "https://www.metacareers.com",
    referer: session.referer,
  };

  if (session.cookie) {
    headers.cookie = session.cookie;
  }

  return fetch(META_GRAPHQL_URL, {
    method: "POST",
    headers,
    body,
    signal,
  });
}
