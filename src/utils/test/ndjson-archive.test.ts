import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendNdjsonPartitions,
  loadNdjsonPartitions,
  writeNdjsonPartitions,
} from "../ndjson-archive";

const tempDirectories: string[] = [];

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jobradar-archive-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("ndjson partitions", () => {
  it("rewrites records into archive chunks and a hot remainder", async () => {
    const directory = await createTempDir();
    const hotPath = path.join(directory, "jobs.ndjson");
    const archiveDir = path.join(directory, "archive");
    const records = Array.from({ length: 2500 }, (_, index) => ({ id: index + 1 }));

    await writeNdjsonPartitions(hotPath, archiveDir, "jobs", records, 1000);

    const archives = (await readdir(archiveDir)).sort();
    expect(archives).toEqual(["jobs-001.ndjson", "jobs-002.ndjson"]);
    expect(await loadNdjsonPartitions<{ id: number }>(hotPath, archiveDir, "jobs")).toEqual(
      records
    );

    const hot = await readFile(hotPath, "utf-8");
    expect(hot.trim().split("\n")).toHaveLength(500);
  });

  it("rotates the hot file when appends reach the chunk size", async () => {
    const directory = await createTempDir();
    const hotPath = path.join(directory, "jobs.ndjson");
    const archiveDir = path.join(directory, "archive");

    await appendNdjsonPartitions(
      hotPath,
      archiveDir,
      "jobs",
      Array.from({ length: 999 }, (_, index) => ({ id: index + 1 })),
      1000
    );
    expect(await readdir(archiveDir)).toEqual([]);

    await appendNdjsonPartitions(hotPath, archiveDir, "jobs", [{ id: 1000 }, { id: 1001 }], 1000);

    expect(await readdir(archiveDir)).toEqual(["jobs-001.ndjson"]);
    expect(await loadNdjsonPartitions<{ id: number }>(hotPath, archiveDir, "jobs")).toEqual(
      Array.from({ length: 1001 }, (_, index) => ({ id: index + 1 }))
    );
    expect((await readFile(hotPath, "utf-8")).trim()).toBe('{"id":1001}');
  });

  it("removes extra archive files when the dataset shrinks", async () => {
    const directory = await createTempDir();
    const hotPath = path.join(directory, "jobs.ndjson");
    const archiveDir = path.join(directory, "archive");

    await writeNdjsonPartitions(
      hotPath,
      archiveDir,
      "jobs",
      Array.from({ length: 2500 }, (_, index) => ({ id: index + 1 })),
      1000
    );
    await writeNdjsonPartitions(
      hotPath,
      archiveDir,
      "jobs",
      Array.from({ length: 500 }, (_, index) => ({ id: index + 1 })),
      1000
    );

    expect(await readdir(archiveDir)).toEqual([]);
    expect(await loadNdjsonPartitions<{ id: number }>(hotPath, archiveDir, "jobs")).toEqual(
      Array.from({ length: 500 }, (_, index) => ({ id: index + 1 }))
    );
  });
});
