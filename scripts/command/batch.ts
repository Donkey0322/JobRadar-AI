import processBatchQueue from "./sync/shared/batch";

export default async function runBatch() {
  await processBatchQueue();
}
