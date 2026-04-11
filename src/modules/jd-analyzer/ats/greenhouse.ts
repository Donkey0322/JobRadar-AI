export function parseGreenhouse(url: string) {
  const u = new URL(url);

  // case 1: embed
  const jobIdFromQuery = u.searchParams.get("gh_jid");
  const companyFromQuery = u.searchParams.get("for");

  if (jobIdFromQuery && companyFromQuery) {
    return {
      company: companyFromQuery,
      jobId: jobIdFromQuery,
    };
  }

  // case 2: normal path
  const parts = u.pathname.split("/").filter(Boolean);

  // /stripe/jobs/1234567
  if (parts.length >= 3 && parts[1] === "jobs") {
    return {
      company: parts[0],
      jobId: parts[2],
    };
  }

  return null;
}
