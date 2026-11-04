import fs from "fs/promises";
import path from "path";

import { generateEmailContent } from "@/modules/notifier/generate";
import * as store from "@/store";

async function main() {
  const jobs = await store.jobs.load();
  const job = jobs.find((job) => job.jd?.citizenship === true && job.jd?.sponsorship === false);
  if (!job) {
    throw new Error("No job found");
  }

  const { html } = generateEmailContent(job);

  const output = path.join(process.cwd(), "preview.html");
  await fs.writeFile(output, html, "utf-8");

  console.log(`✅ Generated: ${output}`);
}

main().catch(console.error);
