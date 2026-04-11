import "dotenv/config";

import processor from "@/main";

const args = new Set(process.argv.slice(2));
const isDev = args.has("--dev");

async function main() {
  await processor([], true, isDev);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
