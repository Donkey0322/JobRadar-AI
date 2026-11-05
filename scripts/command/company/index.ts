import type { Command } from "commander";

export function registerCompany(program: Command) {
  program
    .command("company")
    .description("Maintain stored companies")
    .command("refresh")
    .description("Rebuild companies from stored URLs")
    .action(async () => {
      const { refreshCompanies } = await import("./refresh");
      await refreshCompanies();
    });
}
