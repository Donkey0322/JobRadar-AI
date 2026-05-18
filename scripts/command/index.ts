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

program.parse();
