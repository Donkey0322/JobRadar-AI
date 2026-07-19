import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readJsonFile, readNdjsonFile } from "./data";

const tempDirectories: string[] = [];

async function createTempFile(name: string, content: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jobradar-data-"));
  tempDirectories.push(directory);

  const filePath = path.join(directory, name);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("data file readers", () => {
  it("reads JSON and propagates invalid JSON errors", async () => {
    const validPath = await createTempFile("valid.json", '{"enabled":true}');
    const invalidPath = await createTempFile("invalid.json", "{");

    await expect(readJsonFile<{ enabled: boolean }>(validPath)).resolves.toEqual({
      enabled: true,
    });
    await expect(readJsonFile(invalidPath)).rejects.toBeInstanceOf(SyntaxError);
  });

  it("reads NDJSON while ignoring blank lines", async () => {
    const filePath = await createTempFile("records.ndjson", '{"id":1}\n\n {"id":2} \n');

    await expect(readNdjsonFile<{ id: number }>(filePath)).resolves.toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("adds record context to NDJSON parse errors", async () => {
    const filePath = await createTempFile("invalid.ndjson", '{"id":1}\nnot-json\n');

    await expect(readNdjsonFile(filePath)).rejects.toThrow("Invalid NDJSON at line 2: not-json");
  });
});
