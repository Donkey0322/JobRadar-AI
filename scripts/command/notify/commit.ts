import notifyRange from "./range";

export default async function notifyCommit(commit: string) {
  await notifyRange(`${commit}~1`, commit);
}
