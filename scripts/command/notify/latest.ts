import notifyRange from "./range";

export default async function notifyLatest() {
  await notifyRange("HEAD~1", "HEAD");
}
