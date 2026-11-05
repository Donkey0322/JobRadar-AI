import type { Command } from "commander";

export function registerBoard(program: Command) {
  program
    .command("board")
    .description("Publish the README, subpages, and badges")
    .command("refresh")
    .description("Regenerate the README, subpages, and badges")
    .action(async () => {
      const { updateReadme } = await import("./refresh");
      await updateReadme();
    });
}
