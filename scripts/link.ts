#!/usr/bin/env tsx
import "dotenv/config";

import { analyzeLink } from "../src/modules/jd-analyzer";

async function main() {
  const link = process.argv[2];

  if (!link) {
    console.error("Usage: npm run analyze <job_link>");
    process.exit(1);
  }

  console.log("🔍 Analyzing:", link);

  try {
    const result = await analyzeLink(link);

    if (!result) {
      console.log("No result");
      return;
    }

    console.log("\n✅ Result:");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

main();
