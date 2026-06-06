import { promises as fs } from "fs";

export const readSpec = async (): Promise<string> => {
  return await fs.readFile("./spec.txt", "utf8");
};
