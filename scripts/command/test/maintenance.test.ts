import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const addJob = vi.hoisted(() => vi.fn());
const deleteUrl = vi.hoisted(() => vi.fn());
const cleanUrls = vi.hoisted(() => vi.fn());
const dedup = vi.hoisted(() => vi.fn());
const refreshCompanies = vi.hoisted(() => vi.fn());
const updateReadme = vi.hoisted(() => vi.fn());
const previewEmail = vi.hoisted(() => vi.fn());

vi.mock("../../link", () => ({ addJob }));
vi.mock("../../delete-url", () => ({ deleteUrl }));
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
    deleteUrl.mockReset().mockResolvedValue(undefined);
    cleanUrls.mockReset().mockResolvedValue(undefined);
    dedup.mockReset().mockResolvedValue(undefined);
    refreshCompanies.mockReset().mockResolvedValue(undefined);
    updateReadme.mockReset().mockResolvedValue(undefined);
    previewEmail.mockReset().mockResolvedValue(undefined);
  });

  it("keeps the bin, npm scripts, and workflow entry pointed at the old files", () => {
    expect(readFileSync("bin/jobradar.js", "utf8")).toContain("../scripts/command/index.ts");
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["add-job"]).toBe("tsx scripts/link.ts");
    expect(pkg.scripts["clean-url"]).toBe("tsx scripts/clean-url.ts");
    expect(pkg.scripts["delete-url"]).toBe("tsx scripts/delete-url.ts");
    expect(pkg.scripts.dedup).toBe("tsx scripts/dedup.ts");
    expect(pkg.scripts["refresh-companies"]).toBe("tsx scripts/refresh-companies.ts");
    expect(pkg.scripts["preview-email"]).toBe("tsx scripts/preview-email.ts");
    expect(pkg.scripts["update-readme"]).toBe("tsx scripts/readme.ts");
    expect(readFileSync(".github/workflows/add-job-from-issue.yml", "utf8")).toContain(
      "pnpm tsx scripts/add-job-from-issue.ts"
    );
  });

  it("help lists the existing commands and the maintenance commands", () => {
    const help = runCli("--help");
    const batch = runCli("batch", "--help");
    const urls = runCli("urls", "--help");

    expect(help.status).toBe(0);
    for (const name of ["sync", "scan", "batch", "notify", "setup", "job", "urls", "companies", "readme", "email"]) {
      expect(help.stdout).toContain(name);
    }
    expect(batch.status).toBe(0);
    expect(batch.stdout).toContain("--submit-only");
    expect(urls.status).toBe(0);
    expect(urls.stdout).toContain("clean");
    expect(urls.stdout).toContain("delete");
    expect(urls.stdout).toContain("dedup");
  });

  it("rejects an unknown command", () => {
    const result = runCli("nope");
    expect(result.status).not.toBe(0);
  });

  it("forwards job add flags to the existing adder", async () => {
    process.argv = ["node", "jobradar", "job", "add", "-l", "https://example.com/jobs/1", "-f"];
    await cli().parseAsync(process.argv);
    expect(addJob).toHaveBeenCalledWith(["-l", "https://example.com/jobs/1", "-f"]);
  });

  it("routes urls, companies, readme, and email to the existing scripts", async () => {
    process.argv = ["node", "jobradar", "urls", "clean"];
    await cli().parseAsync(process.argv);
    process.argv = ["node", "jobradar", "urls", "delete", "-l", "https://example.com/jobs/1"];
    await cli().parseAsync(process.argv);
    process.argv = ["node", "jobradar", "urls", "dedup"];
    await cli().parseAsync(process.argv);
    process.argv = ["node", "jobradar", "companies", "refresh"];
    await cli().parseAsync(process.argv);
    process.argv = ["node", "jobradar", "readme"];
    await cli().parseAsync(process.argv);
    process.argv = ["node", "jobradar", "email", "preview"];
    await cli().parseAsync(process.argv);

    expect(cleanUrls).toHaveBeenCalledOnce();
    expect(deleteUrl).toHaveBeenCalledWith(["-l", "https://example.com/jobs/1"]);
    expect(dedup).toHaveBeenCalledOnce();
    expect(refreshCompanies).toHaveBeenCalledOnce();
    expect(updateReadme).toHaveBeenCalledOnce();
    expect(previewEmail).toHaveBeenCalledOnce();
  });
});
