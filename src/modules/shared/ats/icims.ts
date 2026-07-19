import * as cheerio from "cheerio";

import { decodeHtmlEntities } from "@/utils/html";

export type IcimsUrlTarget = "search" | "job";

const ICIMS_JOB_PATH = /\/jobs\/\d+\/[^/]+\/job\/?$/;

export function isIcimsUrl(url: URL, target: IcimsUrlTarget): boolean {
  if (!url.hostname.endsWith(".icims.com")) return false;

  return target === "search" ? url.pathname === "/jobs/search" : ICIMS_JOB_PATH.test(url.pathname);
}

export function normalizeIcimsUrl(rawUrl: string, target: IcimsUrlTarget): string {
  const url = new URL(rawUrl);

  if (target === "search") {
    url.pathname = "/jobs/search";
  } else {
    url.search = "";
  }

  url.searchParams.set("in_iframe", "1");

  return url.toString();
}

function getIframeSelector(target: IcimsUrlTarget): string {
  return target === "search" ? "iframe[src*='/jobs/search']" : "iframe[src*='/jobs/'][src*='/job']";
}

function hasTargetPath(rawUrl: string, baseUrl: string, target: IcimsUrlTarget): boolean {
  const pathname = new URL(decodeHtmlEntities(rawUrl), baseUrl).pathname;

  return target === "search" ? pathname === "/jobs/search" : ICIMS_JOB_PATH.test(pathname);
}

function getIframePattern(target: IcimsUrlTarget): RegExp {
  return target === "search"
    ? /<iframe[^>]+src=["']([^"']*(?:icims\.com\/jobs\/search|\/jobs\/search)[^"']*)["']/i
    : /<iframe[^>]+src=["']([^"']*(?:icims\.com\/jobs\/\d+\/[^"']*\/job|\/jobs\/\d+\/[^"']*\/job)[^"']*)["']/i;
}

function getRawUrlPattern(target: IcimsUrlTarget): RegExp {
  return target === "search"
    ? /https?:\/\/[^"'<>\s]+\.icims\.com\/jobs\/search[^"'<>\s]*/i
    : /https?:\/\/[^"'<>\s]+\.icims\.com\/jobs\/\d+\/[^"'<>\s]+\/job[^"'<>\s]*/i;
}

function resolveUrl(rawUrl: string, baseUrl: string): string {
  return new URL(decodeHtmlEntities(rawUrl), baseUrl).toString();
}

export function findIcimsIframeSrc(
  html: string,
  baseUrl: string,
  target: IcimsUrlTarget
): string | null {
  const $ = cheerio.load(html);
  const selector = getIframeSelector(target);
  const normalSrc = $(selector)
    .toArray()
    .map((el) => $(el).attr("src"))
    .find((src): src is string => !!src && hasTargetPath(src, baseUrl, target));

  if (normalSrc) {
    return resolveUrl(normalSrc, baseUrl);
  }

  for (const el of $("noscript").toArray()) {
    const noscriptHtml = $(el).html() ?? $(el).text();
    if (!noscriptHtml) continue;

    const $$ = cheerio.load(decodeHtmlEntities(noscriptHtml));
    const src = $$(selector)
      .toArray()
      .map((iframe) => $$(iframe).attr("src"))
      .find((value): value is string => !!value && hasTargetPath(value, baseUrl, target));

    if (src) {
      return resolveUrl(src, baseUrl);
    }
  }

  const iframeMatch = html.match(getIframePattern(target));

  if (iframeMatch?.[1]) {
    return resolveUrl(iframeMatch[1], baseUrl);
  }

  const rawUrlMatch = html.match(getRawUrlPattern(target));

  return rawUrlMatch?.[0] ? decodeHtmlEntities(rawUrlMatch[0]) : null;
}
