import processBatchQueue from "./sync/shared/batch";

export default async function runBatch(options: { ifDue?: boolean } = {}) {
  await processBatchQueue(undefined, options);
}
