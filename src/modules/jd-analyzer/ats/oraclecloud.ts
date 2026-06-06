import { RED_CROSS } from "@/constants/log";

import { logger } from "@/utils/logger";

export async function fetchOracleJD(url: string) {
  const u = new URL(url);

  const match = u.pathname.match(/\/sites\/([^/]+)\/job\/([^/]+)/);

  if (!match) {
    logger.error({ url }, `${RED_CROSS} Invalid Oracle job URL`);
    return null;
  }

  const [, siteNumber, jobId] = match;

  const apiUrl =
    `${u.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails` +
    `?expand=all&onlyData=true` +
    `&finder=ById;Id="${jobId}",siteNumber=${siteNumber}`;

  try {
    const res = await fetch(apiUrl);

    if (!res.ok) {
      logger.error(
        {
          apiUrl,
          status: res.status,
          statusText: res.statusText,
        },
        `${RED_CROSS} Failed to fetch Oracle JD`
      );

      return null;
    }

    const data = await res.json();

    return JSON.stringify(data.items[0]);
  } catch (error) {
    logger.error(
      {
        err: error,
        apiUrl,
      },
      `${RED_CROSS} Error fetching Oracle JD`
    );

    return null;
  }
}
