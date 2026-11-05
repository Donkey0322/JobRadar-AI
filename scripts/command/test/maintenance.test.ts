import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const addJob = vi.hoisted(() => vi.fn());
const analyzeJobs = vi.hoisted(() => vi.fn());
const deleteUrls = vi.hoisted(() => vi.fn());
const cleanUrls = vi.hoisted(() => vi.fn());
const dedup = vi.hoisted(() => vi.fn());
const refreshCompanies = vi.hoisted(() => vi.fn());
const updateReadme = vi.hoisted(() => vi.fn());
const previewEmail = vi.hoisted(() => vi.fn());

vi.mock("../../link", () => ({ addJob, analyzeJobs }));
vi.mock("../../delete-url", () => ({ deleteUrls }));
vi.mock("../../clean-url", () => ({ cleanUrls }));
vi.mock("../../dedup", () => ({ default: dedup }));
vi.mock("../../refresh-companies", () => ({ refreshCompanies }));
vi.mock("../../readme", () => ({ updateReadme }));
vi.mock("../../preview-email", () => ({ previewEmail }));

import { registerMaintenance } from "../maintenance";

function runCli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/command/index.ts", ...args], {
    encoding: "utf8",
  });
}

function cli() {
  const program = new Command();
  program.exitOverride();
  program.name("jobradar");
  registerMaintenance(program);
  return program;
}

describe("jobctl maintenance commands", () => {
  beforeEach(() => {
    addJob.mockReset().mockResolvedValue(undefined);
    analyzeJobs.mockReset().mockResolvedValue(undefined);
    deleteUrls.mockReset().mockResolvedValue(undefined);
    cleanUrls.mockReset().mockResolvedValue(undefined);
    dedup.mockReset().mockResolvedValue(undefined);
    refreshCompanies.mockReset().mockResolvedValue(undefined);
    updateReadme.mockReset().mockResolvedValue(undefined);
    previewEmail.mockReset().mockResolvedValue(undefined);
  });

  it("keeps the bin and the issue workflow, and drops the old npm scripts", () => {
    expect(readFileSync("bin/jobradar.js", "utf8")).toContain("../scripts/command/index.ts");
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
      fig: { jobctl: { subcommands: { name: string; subcommands?: { name: string }[] }[] } };
    };
    expect(Object.keys(pkg.scripts)).toEqual([
      "jobctl",
      "test",
      "test:ai-eval",
      "typecheck",
      "lint",
    ]);
    expect(pkg.scripts.jobctl).toBe("tsx scripts/command/index.ts");
    expect(readFileSync(".github/workflows/add-job-from-issue.yml", "utf8")).toContain(
      "pnpm tsx scripts/add-job-from-issue.ts"
    );
    expect(readFileSync(".github/workflows/clean-outdated-url.yml", "utf8")).toContain(
      "pnpm jobctl job clean"
    );
    expect(readFileSync(".github/workflows/readme-update.yml", "utf8")).toContain(
      "pnpm jobctl board refresh"
    );
    const names = (commands: { name: string }[]) => commands.map((command) => command.name);
    expect(names(pkg.fig.jobctl.subcommands)).toEqual([
      "scan",
      "sync",
      "batch",
      "notify",
      "setup",
      "job",
      "company",
      "board",
      "email",
    ]);
    const job = pkg.fig.jobctl.subcommands.find((command) => command.name === "job");
    expect(names(job?.subcommands ?? [])).toEqual(["add", "analyze", "delete", "clean", "dedup"]);
    expect(
      names(pkg.fig.jobctl.subcommands.find((command) => command.name === "company")?.subcommands ?? [])
    ).toEqual(["refresh"]);
    expect(
      names(pkg.fig.jobctl.subcommands.find((command) => command.name === "board")?.subcommands ?? [])
    ).toEqual(["refresh"]);
  });

  it("help lists the command tree", () => {
    const help = runCli("--help");
    const job = runCli("job", "--help");
    const add = runCli("job", "add", "--help");
    const analyze = runCli("job", "analyze", "--help");
    const remove = runCli("job", "delete", "--help");
    const company = runCli("company", "--help");
    const board = runCli("board", "--help");
    const batch = runCli("batch", "--help");

    expect(help.status).toBe(0);
    for (const name of ["sync", "scan", "batch", "notify", "setup", "job", "company", "board", "email"]) {
      expect(help.stdout).toContain(name);
    }
    expect(help.stdout).not.toMatch(/\n\s+urls\b/);
    expect(help.stdout).not.toMatch(/\n\s+readme\b/);
    expect(job.status).toBe(0);
    for (const name of ["add", "analyze", "delete", "clean", "dedup"]) {
      expect(job.stdout).toContain(name);
    }
    expect(add.status).toBe(0);
    expect(add.stdout).toContain("--link");
    expect(add.stdout).toContain("--file");
    expect(analyze.status).toBe(0);
    expect(analyze.stdout).toContain("--link");
    expect(remove.status).toBe(0);
    expect(remove.stdout).toContain("--link");
    expect(remove.stdout).toContain("--file");
    expect(company.status).toBe(0);
    expect(company.stdout).toContain("refresh");
    expect(board.status).toBe(0);
    expect(board.stdout).toContain("refresh");
    expect(batch.status).toBe(0);
    expect(batch.stdout).toContain("--submit-only");
  }, 20_000);

  it("rejects an unknown command", () => {
    const result = runCli("nope");
    expect(result.status).not.toBe(0);
  }, 20_000);

  it("routes job, company, board, and email commands", async () => {
    await cli().parseAsync(["node", "jobradar", "job", "clean"]);
    await cli().parseAsync(["node", "jobradar", "job", "dedup"]);
    await cli().parseAsync(["node", "jobradar", "company", "refresh"]);
    await cli().parseAsync(["node", "jobradar", "board", "refresh"]);
    await cli().parseAsync(["node", "jobradar", "email", "preview"]);
    await cli().parseAsync(["node", "jobradar", "job", "add", "-f"]);
    await cli().parseAsync([
      "node",
      "jobradar",
      "job",
      "add",
      "-l",
      "https://example.com/jobs/1",
      "--link",
      "https://example.com/jobs/2",
    ]);
    await cli().parseAsync([
      "node",
      "jobradar",
      "job",
      "analyze",
      "-l",
      "https://example.com/jobs/1",
      "-l",
      "https://example.com/jobs/2",
    ]);
    await cli().parseAsync([
      "node",
      "jobradar",
      "job",
      "delete",
      "-l",
      "https://example.com/jobs/1",
      "-l",
      "https://example.com/jobs/2",
    ]);

    expect(cleanUrls).toHaveBeenCalledOnce();
    expect(dedup).toHaveBeenCalledOnce();
    expect(refreshCompanies).toHaveBeenCalledOnce();
    expect(updateReadme).toHaveBeenCalledOnce();
    expect(previewEmail).toHaveBeenCalledOnce();
    expect(addJob).toHaveBeenNthCalledWith(1, { links: [], file: "scripts/job.json" });
    expect(addJob).toHaveBeenNthCalledWith(2, {
      links: ["https://example.com/jobs/1", "https://example.com/jobs/2"],
      file: undefined,
    });
    expect(analyzeJobs).toHaveBeenCalledWith([
      "https://example.com/jobs/1",
      "https://example.com/jobs/2",
    ]);
    expect(deleteUrls).toHaveBeenCalledWith({
      links: ["https://example.com/jobs/1", "https://example.com/jobs/2"],
      file: undefined,
    });
  });

  it("rejects a repeated file flag and combining link with file", async () => {
    await expect(
      cli().parseAsync(["node", "jobradar", "job", "add", "-f", "a.json", "--file", "b.json"])
    ).rejects.toThrow(/--file cannot be repeated/);
    await expect(
      cli().parseAsync([
        "node",
        "jobradar",
        "job",
        "add",
        "-l",
        "https://example.com/jobs/1",
        "-f",
        "a.json",
      ])
    ).rejects.toThrow(/cannot be used with/);
    await expect(
      cli().parseAsync([
        "node",
        "jobradar",
        "job",
        "delete",
        "--file",
        "urls.txt",
        "--file",
        "other.txt",
      ])
    ).rejects.toThrow(/--file cannot be repeated/);
    expect(addJob).not.toHaveBeenCalled();
    expect(deleteUrls).not.toHaveBeenCalled();
  });
});
