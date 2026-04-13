import { classifyATS } from "../company-tacker/ats";

import {
  getAshbyKey,
  getCustomKey,
  getGreenhouseKey,
  getIcimsKey,
  getLeverKey,
  getOracleKey,
  getSmartRecruitersKey,
  getWorkdayKey,
} from "./ats";
import { normalizeUrl } from "./utils";

import { loadSent, saveSent } from "@/utils/data";

function getJobKey(url: string) {
  try {
    const u = new URL(url);
    const ats = classifyATS(u);

    switch (ats) {
      case "greenhouse":
        return getGreenhouseKey(u) ?? `greenhouse:${normalizeUrl(url)}`;

      case "workday":
        return getWorkdayKey(url) ?? `workday:${normalizeUrl(url)}`;

      case "ashby":
        return getAshbyKey(u) ?? `ashby:${normalizeUrl(url)}`;

      case "lever":
        return getLeverKey(u) ?? `lever:${normalizeUrl(url)}`;

      case "smartrecruiters":
        return getSmartRecruitersKey(u.pathname) ?? `smartrecruiters:${normalizeUrl(url)}`;

      case "oraclecloud":
        return getOracleKey(u.pathname) ?? `oraclecloud:${normalizeUrl(url)}`;

      case "icims":
        return getIcimsKey(u.pathname) ?? `icims:${normalizeUrl(url)}`;

      case "custom":
        return getCustomKey(url);

      default:
        return `url:${normalizeUrl(url)}`;
    }
  } catch {
    return `url:${url}`;
  }
}

function groupUrlsByKey(urls: string[]) {
  const map = new Map<string, string[]>();

  for (const url of urls) {
    const key = getJobKey(url);
    if (!key) {
      continue;
    }

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key)!.push(url);
  }

  return map;
}

function mapToJson(map: Map<string, string[]>) {
  const obj: Record<string, string[]> = {};

  for (const [key, urls] of map.entries()) {
    obj[key] = urls;
  }

  return obj;
}

export function deduplicate(urls: string[]) {
  const grouped = groupUrlsByKey(urls);
  const json = mapToJson(grouped);
  return Object.values(json).map((urls) => urls[0]);
}

async function main() {
  const sent = await loadSent();
  const deduped = deduplicate(Array.from(sent));
  await saveSent(new Set(deduped));

  console.log("original:", sent.size);
  console.log("unique jobs:", deduped.length);
}

main();
