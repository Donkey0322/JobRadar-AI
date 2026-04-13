import "dotenv/config";

import processor from "../src/main";
import crawler from "../src/modules/company-tacker/fetch";

const args = new Set(process.argv.slice(2));
const isDev = args.has("--dev");

async function main() {
  const jobs = await crawler();
  await processor(jobs, false, isDev);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
