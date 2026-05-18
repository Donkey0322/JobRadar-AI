import { Command } from "commander";

const program = new Command();

program.name("jobradar");

const sync = program.command("sync");

sync
  .command("community")
  .description("Sync jobs from community sources")
  .action(async () => {
    const { default: syncCommunity } = await import("./sync/community");

    await syncCommunity();
  });

sync
  .command("discover")
  .description("Discover jobs from ATS patterns")
  .action(async () => {
    const { default: syncDiscover } = await import("./sync/discover");

    await syncDiscover();
  });

const notify = program.command("notify");

notify.command("latest").action(async () => {
  const { default: notifyLatest } = await import("./notify/latest");

  await notifyLatest();
});

notify
  .command("range")
  .argument("<from>")
  .argument("<to>")
  .action(async (from, to) => {
    const { default: notifyRange } = await import("./notify/range");

    await notifyRange(from, to);
  });

notify
  .command("commit")
  .argument("<commit>")
  .action(async (commit) => {
    const { default: notifyCommit } = await import("./notify/commit");

    await notifyCommit(commit);
  });

program.parse();
