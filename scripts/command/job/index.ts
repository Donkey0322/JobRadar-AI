import { type Command, InvalidArgumentError, Option } from "commander";

const DEFAULT_JOB_FILE = "scripts/job.json";

function collect(value: string, previous: string[] = []) {
  previous.push(value);
  return previous;
}

function oneFile(value: string, previous: string | undefined) {
  if (previous !== undefined) {
    throw new InvalidArgumentError("--file cannot be repeated");
  }

  return value;
}

export function registerJob(program: Command) {
  const job = program.command("job").description("Maintain stored jobs");

  job
    .command("add")
    .description("Add jobs from links, a JSON file, or interactive prompts")
    .addOption(
      new Option("-l, --link <url>", "Job URL. Repeat to add more than one")
        .argParser(collect)
        .conflicts("file")
    )
    .addOption(
      new Option("-f, --file [jobs.json]", "JSON file of one Job or a Job array")
        .preset(DEFAULT_JOB_FILE)
        .argParser(oneFile)
        .conflicts("link")
    )
    .action(async (options: { link?: string[]; file?: string }) => {
      const { addJob } = await import("./add");
      await addJob({ links: options.link ?? [], file: options.file });
    });

  job
    .command("analyze")
    .description("Print JD analysis for URLs without storing jobs")
    .addOption(
      new Option("-l, --link <url>", "Job URL. Repeat to analyze more than one").argParser(collect)
    )
    .action(async (options: { link?: string[] }) => {
      const { analyzeJobs } = await import("./analyze");
      await analyzeJobs(options.link ?? []);
    });

  job
    .command("delete")
    .description("Delete exact posting URLs from urls, companies, and opportunities")
    .addOption(
      new Option("-l, --link <url>", "Exact posting URL. Repeat to delete more than one")
        .argParser(collect)
        .conflicts("file")
    )
    .addOption(
      new Option("-f, --file <urls.txt>", "Text file with one exact URL per line")
        .argParser(oneFile)
        .conflicts("link")
    )
    .action(async (options: { link?: string[]; file?: string }) => {
      const { deleteUrls } = await import("./delete");
      await deleteUrls({ links: options.link ?? [], file: options.file });
    });

  job
    .command("clean")
    .description("Drop dead posting URLs and refresh companies")
    .action(async () => {
      const { cleanUrls } = await import("./clean");
      await cleanUrls();
    });

  job
    .command("dedup")
    .description("Deduplicate stored URLs and opportunities")
    .action(async () => {
      const dedup = (await import("./dedup")).default;
      await dedup();
    });
}
