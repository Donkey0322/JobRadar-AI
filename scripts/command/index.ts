import { Command } from "commander";

const program = new Command();

program.name("jobradar");

const sync = program.command("sync");

sync.description("Sync jobs from community sources").action(async () => {
  const { default: checkConfig } = await import("./setup/checkConfig");
  await checkConfig();

  const { default: syncCommunity } = await import("./sync/community");
  await syncCommunity();
});

const scan = program.command("scan");
scan.description("Scan jobs from ATS patterns").action(async () => {
  const { default: checkConfig } = await import("./setup/checkConfig");
  await checkConfig();

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

program
  .command("batch")
  .description("Submit and collect cheaper batch analysis for queued jobs")
  .option("--submit-only", "Submit queued jobs, then exit without waiting for results")
  .action(async (options: { submitOnly?: boolean }) => {
    const { default: checkConfig } = await import("./setup/checkConfig");
    await checkConfig();

    const { default: runBatch } = await import("./batch");
    await runBatch({ submitOnly: Boolean(options.submitOnly) });
  });

const setup = program.command("setup");

setup.command("check-config").action(async () => {
  const { default: checkConfig } = await import("./setup/checkConfig");
  await checkConfig();
});

setup.command("get-config").action(async () => {
  const { default: getConfig } = await import("./setup/getConfig");
  await getConfig();
});

program.parse();
