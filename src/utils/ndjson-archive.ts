import { promises as fs } from "node:fs";
import path from "node:path";

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function archiveFileName(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(3, "0")}.ndjson`;
}

/**
 * Read and parse an NDJSON file. Blank lines are ignored; file-system and
 * parse errors are propagated.
 */
export async function readNdjsonFile<T>(filePath: string): Promise<T[]> {
  const content = await fs.readFile(filePath, "utf-8");

  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`Invalid NDJSON at line ${index + 1}: ${line}`, {
          cause: error,
        });
      }
    });
}

export async function readNdjsonFileIfExists<T>(filePath: string): Promise<T[]> {
  try {
    return await readNdjsonFile<T>(filePath);
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
}

function toNdjson(records: unknown[]): string {
  if (records.length === 0) {
    return "";
  }

  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

async function writeNdjson(filePath: string, records: unknown[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, toNdjson(records), "utf-8");
}

export async function listArchiveParts(
  archiveDir: string,
  prefix: string
): Promise<Array<{ index: number; filePath: string }>> {
  let names: string[];

  try {
    names = await fs.readdir(archiveDir);
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }

  return names
    .flatMap((name) => {
      const match = name.match(new RegExp(`^${prefix}-(\\d+)\\.ndjson$`));
      if (!match) {
        return [];
      }

      return [{ index: Number(match[1]), filePath: path.join(archiveDir, name) }];
    })
    .sort((left, right) => left.index - right.index);
}

export async function loadNdjsonPartitions<T>(
  hotPath: string,
  archiveDir: string,
  prefix: string
): Promise<T[]> {
  const parts = await listArchiveParts(archiveDir, prefix);
  const records: T[] = [];

  for (const part of parts) {
    records.push(...(await readNdjsonFileIfExists<T>(part.filePath)));
  }

  records.push(...(await readNdjsonFileIfExists<T>(hotPath)));
  return records;
}

export async function writeNdjsonPartitions<T>(
  hotPath: string,
  archiveDir: string,
  prefix: string,
  records: T[],
  chunkSize: number
): Promise<void> {
  await fs.mkdir(archiveDir, { recursive: true });

  const existing = await listArchiveParts(archiveDir, prefix);
  const archiveCount = Math.floor(records.length / chunkSize);

  for (let index = 0; index < archiveCount; index++) {
    const chunk = records.slice(index * chunkSize, (index + 1) * chunkSize);
    await writeNdjson(path.join(archiveDir, archiveFileName(prefix, index + 1)), chunk);
  }

  await writeNdjson(hotPath, records.slice(archiveCount * chunkSize));

  await Promise.all(
    existing
      .filter((part) => part.index > archiveCount)
      .map((part) => fs.unlink(part.filePath))
  );
}

export async function appendNdjsonPartitions<T>(
  hotPath: string,
  archiveDir: string,
  prefix: string,
  records: T[],
  chunkSize: number
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  await fs.mkdir(path.dirname(hotPath), { recursive: true });
  await fs.mkdir(archiveDir, { recursive: true });
  await fs.appendFile(hotPath, toNdjson(records), "utf-8");

  const hot = await readNdjsonFileIfExists<T>(hotPath);
  if (hot.length < chunkSize) {
    return;
  }

  const parts = await listArchiveParts(archiveDir, prefix);
  let nextIndex = (parts.at(-1)?.index ?? 0) + 1;
  let remaining = hot;

  while (remaining.length >= chunkSize) {
    const chunk = remaining.slice(0, chunkSize);
    remaining = remaining.slice(chunkSize);
    await writeNdjson(path.join(archiveDir, archiveFileName(prefix, nextIndex)), chunk);
    nextIndex += 1;
  }

  await writeNdjson(hotPath, remaining);
}
