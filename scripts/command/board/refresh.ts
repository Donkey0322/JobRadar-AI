import fs from "node:fs/promises";
import path from "node:path";

import { recordStage } from "../../github/summary";

import { CONFIG } from "@/config";
import { renderBoard, selectTargetOpportunities } from "@/modules/board";
import * as store from "@/store";

const ROOT = process.cwd();

const README_PATH = path.join(ROOT, "README.md");
const JOB_POSTINGS_DIR = path.join(ROOT, "job-postings");
const FEATURED_BADGES_DIR = path.join(ROOT, "assets", "featured-badges");

export async function updateReadme() {
  try {
    const opportunities = await store.opportunities.load();
    const generatedAt = new Date();
    const board = renderBoard({ opportunities, config: CONFIG, generatedAt });
    const included = selectTargetOpportunities(opportunities, CONFIG).targetOpportunities.length;

    await writeFeaturedCompanyBadges(board.badges);
    await writeCategoryPages(board.pages);
    await fs.writeFile(README_PATH, board.readme, "utf-8");

    console.log(`README generated: ${README_PATH}`);
    console.log(`Category pages generated: ${board.pages.length}`);
    console.log(`Target opportunities included: ${included}`);
    recordStage({
      stage: "board",
      status: "success",
      pages: board.pages.length,
      included,
      saved: "complete",
    });
  } catch (error) {
    recordStage({
      stage: "board",
      status: "failed",
      reason: "board refresh failed",
      saved: "unknown",
    });
    throw error;
  }
}

async function writeCategoryPages(pages: { fileName: string; markdown: string }[]): Promise<void> {
  await fs.mkdir(JOB_POSTINGS_DIR, { recursive: true });

  const existingFiles = await fs.readdir(JOB_POSTINGS_DIR);
  await Promise.all(
    existingFiles
      .filter((fileName) => fileName.endsWith(".md"))
      .map((fileName) => fs.rm(path.join(JOB_POSTINGS_DIR, fileName)))
  );

  await Promise.all(
    pages.map((page) =>
      fs.writeFile(path.join(JOB_POSTINGS_DIR, page.fileName), page.markdown, "utf-8")
    )
  );
}

async function writeFeaturedCompanyBadges(badges: { fileName: string; svg: string }[]): Promise<void> {
  await fs.mkdir(FEATURED_BADGES_DIR, { recursive: true });

  await Promise.all(
    badges.map((badge) =>
      fs.writeFile(path.join(FEATURED_BADGES_DIR, badge.fileName), badge.svg, "utf-8")
    )
  );
}
