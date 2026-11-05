import type { Command } from "commander";

/** Maintenance commands. Each action calls the existing script with its own argv. */
export function registerMaintenance(program: Command) {
  const job = program.command("job").description("Maintain one job");

  job
    .command("add")
    .description("Add a job from -l, -f, or interactive prompts")
    .argument("[args...]")
    .allowUnknownOption()
    .action(async (args: string[]) => {
      const { addJob } = await import("../link");
      await addJob(args);
    });

  const urls = program.command("urls").description("Maintain stored URLs");

  urls
    .command("clean")
    .description("Drop dead posting URLs and refresh companies")
    .action(async () => {
      const { cleanUrls } = await import("../clean-url");
      await cleanUrls();
    });

  urls
    .command("delete")
    .description("Delete one exact URL from urls, companies, and opportunities")
    .argument("[args...]")
    .allowUnknownOption()
    .action(async (args: string[]) => {
      const { deleteUrl } = await import("../delete-url");
      await deleteUrl(args);
    });

  urls
    .command("dedup")
    .description("Deduplicate stored URLs and opportunities")
    .action(async () => {
      const dedup = (await import("../dedup")).default;
      await dedup();
    });

  const companies = program.command("companies").description("Maintain the company list");

  companies
    .command("refresh")
    .description("Rebuild companies from stored URLs")
    .action(async () => {
      const { refreshCompanies } = await import("../refresh-companies");
      await refreshCompanies();
    });

  program
    .command("readme")
    .description("Regenerate the README, subpages, and badges")
    .action(async () => {
      const { updateReadme } = await import("../readme");
      await updateReadme();
    });

  const email = program.command("email").description("Email tools");

  email
    .command("preview")
    .description("Write preview.html for one stored job")
    .action(async () => {
      const { previewEmail } = await import("../preview-email");
      await previewEmail();
    });
}
