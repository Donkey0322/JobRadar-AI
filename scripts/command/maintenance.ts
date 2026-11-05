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

/** Maintenance commands. Flags and conflicts are declared here. */
export function registerMaintenance(program: Command) {
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
      const { addJob } = await import("../link");
      await addJob({ links: options.link ?? [], file: options.file });
    });

  job
    .command("analyze")
    .description("Print JD analysis for URLs without storing jobs")
    .addOption(
      new Option("-l, --link <url>", "Job URL. Repeat to analyze more than one").argParser(collect)
    )
    .action(async (options: { link?: string[] }) => {
      const { analyzeJobs } = await import("../link");
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
      const { deleteUrls } = await import("../delete-url");
      await deleteUrls({ links: options.link ?? [], file: options.file });
    });

  job
    .command("clean")
    .description("Drop dead posting URLs and refresh companies")
    .action(async () => {
      const { cleanUrls } = await import("../clean-url");
      await cleanUrls();
    });

  job
    .command("dedup")
    .description("Deduplicate stored URLs and opportunities")
    .action(async () => {
      const dedup = (await import("../dedup")).default;
      await dedup();
    });

  program
    .command("company")
    .description("Maintain stored companies")
    .command("refresh")
    .description("Rebuild companies from stored URLs")
    .action(async () => {
      const { refreshCompanies } = await import("../refresh-companies");
      await refreshCompanies();
    });

  program
    .command("board")
    .description("Publish the README, subpages, and badges")
    .command("refresh")
    .description("Regenerate the README, subpages, and badges")
    .action(async () => {
      const { updateReadme } = await import("../readme");
      await updateReadme();
    });

  program
    .command("email")
    .description("Email tools")
    .command("preview")
    .description("Write preview.html for one stored job")
    .action(async () => {
      const { previewEmail } = await import("../preview-email");
      await previewEmail();
    });
}
