import type { Command } from "commander";

export function registerEmail(program: Command) {
  program
    .command("email")
    .description("Email tools")
    .command("preview")
    .description("Write preview.html for one stored job")
    .action(async () => {
      const { previewEmail } = await import("./preview");
      await previewEmail();
    });
}
