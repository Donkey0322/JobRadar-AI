import processBatchQueue from "./sync/shared/batch";

export default async function runBatch(options: { submitOnly?: boolean } = {}) {
  await processBatchQueue(undefined, { wait: !options.submitOnly });
}
