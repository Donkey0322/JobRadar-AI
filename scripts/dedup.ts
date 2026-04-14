import { deduplicate } from "../src/modules/job-dedup";
import { loadUrls } from "../src/utils/data";
import { saveUrls } from "../src/utils/data";

async function main() {
  const sent = await loadUrls();
  const deduped = deduplicate(Array.from(sent));
  await saveUrls(new Set(deduped));

  console.log("original:", sent.size);
  console.log("unique jobs:", deduped.length);
}

main();
