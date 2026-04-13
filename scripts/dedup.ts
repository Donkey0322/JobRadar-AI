import { deduplicate } from "../src/modules/job-dedup";
import { loadSent } from "../src/utils/data";
import { saveSent } from "../src/utils/data";

async function main() {
  const sent = await loadSent();
  const deduped = deduplicate(Array.from(sent));
  await saveSent(new Set(deduped));

  console.log("original:", sent.size);
  console.log("unique jobs:", deduped.length);
}

main();
