/**
 * Opt-in parse of the patched pnpm spec through the local Easy Complete bundle.
 * `pnpm test` does not include this file.
 *
 *   EASY_COMPLETE_BUNDLE=<autocomplete bundle> \
 *   EASY_COMPLETE_PNPM_SPEC=<pnpm.js the app loads> \
 *   pnpm exec vitest run --config vitest.integration.config.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { patchInstalledPnpmSpec } from "../pnpm-spec-patch";

const REPO = path.resolve(import.meta.dirname, "../../..");

function specPath(name: "EASY_COMPLETE_BUNDLE" | "EASY_COMPLETE_PNPM_SPEC") {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `${name} must point at a local Easy Complete file before this parser test can run`
    );
  }

  if (!existsSync(value)) {
    throw new Error(`${name} does not exist: ${value}`);
  }

  return value;
}

function installGlobal(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

type Parser = {
  cb: (
    command: { tokens: { text: string }[] },
    context: { currentWorkingDirectory: string; currentProcess: string },
    locations: { name: string; type: string; path: string }[],
    history: boolean
  ) => Promise<{ completionObj: SpecNode }>;
  nb: (state: { completionObj: SpecNode }) => {
    completionObj: SpecNode;
    currentArg?: {
      generators?: { postProcess?: (stdout: string, tokens: string[]) => Suggestion[] }[];
    };
  };
};

type SpecNode = {
  name?: string | string[];
  subcommands?: Record<string, SpecNode>;
  options?: Record<string, { name?: string[] }>;
  persistentOptions?: Record<string, { name?: string[] }>;
  args?: { generators?: { postProcess?: (stdout: string, tokens: string[]) => Suggestion[] }[] }[];
};

type Suggestion = { name?: string | string[] };

let parser: Parser;
let specProject = "";
const commands = new Set<string>();

async function installParser() {
  const source = readFileSync(specPath("EASY_COMPLETE_BUNDLE"), "utf8");
  const patched = source
    .replace(
      "async function go(e){let t=await Va({path:po({path:e,expandTildeInPath:!0})});return t.type?.case===`text`?t.type.value:null}",
      "async function go(e){return globalThis.__ecReadFile(e)}"
    )
    .replace(
      "async function d_(e){let{completions:t}=await u_();return t.has(e)}async function f_(e){let{diffVersionedSpecs:t}=await u_();return t.has(e)}",
      "async function d_(e){return false}async function f_(e){return false}"
    )
    .replace(
      "async function Lo({executable:e,args:t,environment:n,workingDirectory:r,terminalSessionId:i,timeout:a}){let o=n??{};return Ka({executable:e,arguments:t,env:Object.keys(o).map(e=>A(Pr,{key:e,value:o[e]})),workingDirectory:r,terminalSessionId:i,timeout:a?A(Nr,{nanos:Math.floor(a%1e3*1e6),secs:BigInt(Math.floor(a/1e3))}):void 0})}",
      "async function Lo({executable:e,args:t,workingDirectory:r}){return globalThis.__ecSpawn({executable:e,args:t,workingDirectory:r})}"
    )
    .replace(/Rs\.watch\(\)[\s\S]*$/, "globalThis.__ecParser={cb,nb};");

  if (patched === source) throw new Error("Could not isolate the Easy Complete parser");

  const directory = mkdtempSync(path.join(os.tmpdir(), "jobradar-ec-parser-"));
  const file = path.join(directory, "parser.mjs");
  writeFileSync(file, patched);
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));

  const blobDirectory = path.join(directory, "blobs");
  mkdirSync(blobDirectory);
  let blobId = 0;
  const NativeBlob = globalThis.Blob;
  globalThis.Blob = class extends NativeBlob {
    textParts: string;
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options);
      this.textParts = (parts ?? []).map((part) => (typeof part === "string" ? part : "")).join("");
    }
  };
  globalThis.URL.createObjectURL = (blob: Blob) => {
    const specFile = path.join(blobDirectory, `spec-${(blobId += 1)}.mjs`);
    writeFileSync(specFile, (blob as Blob & { textParts?: string }).textParts ?? "");
    return pathToFileURL(specFile).href;
  };

  await import(pathToFileURL(file).href);
  parser = (globalThis as typeof globalThis & { __ecParser: Parser }).__ecParser;
}

function shellResult(stdout: string, exitCode = 0) {
  return Promise.resolve({ exitCode, stdout, stderr: "" });
}

beforeAll(async () => {
  const spec = patchInstalledPnpmSpec(readFileSync(specPath("EASY_COMPLETE_PNPM_SPEC"), "utf8"));
  specProject = mkdtempSync(path.join(os.tmpdir(), "jobradar-ec-spec-"));
  const specRoot = path.join(specProject, ".fig", "autocomplete", "build");
  mkdirSync(specRoot, { recursive: true });
  writeFileSync(path.join(specRoot, "pnpm.js"), spec);

  (globalThis as typeof globalThis & { __ecReadFile: (file: string) => string }).__ecReadFile = (
    file
  ) => readFileSync(file, "utf8");
  (
    globalThis as typeof globalThis & {
      __ecSpawn: (command: {
        executable: string;
        args?: string[];
        workingDirectory?: string;
      }) => Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
      }>;
    }
  ).__ecSpawn = ({ executable, args = [], workingDirectory }) => {
    const rendered = [executable, ...args].join(" ");
    commands.add(rendered);

    if (rendered.includes("jobctl") || rendered.includes("tsx")) {
      return Promise.reject(new Error(`completion tried to run ${rendered}`));
    }

    if (executable === "pnpm" && args[0] === "ls") return shellResult("");

    if (executable !== "bash") return Promise.reject(new Error(`unexpected command ${rendered}`));

    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: workingDirectory || REPO });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`timed out: ${rendered}`));
      }, 8000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  };

  installGlobal("window", globalThis);
  installGlobal("fig", { constants: { os: "macos" } });
  const domNode = () => {
    const node: Record<string | symbol, unknown> = {};
    return new Proxy(node, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === "style") return (target.style = {});
        if (prop === "relList") return { supports: () => true };
        if (prop === "childNodes" || prop === "children") return [];
        if (prop === "nodeType") return 1;
        return () => nodeProxy;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    });
  };
  const nodeProxy = domNode();
  installGlobal("document", {
    createElement: () => domNode(),
    createElementNS: () => domNode(),
    querySelectorAll: () => [],
    documentElement: domNode(),
    getElementById: () => domNode(),
    head: domNode(),
    body: domNode(),
    cookie: "",
    addEventListener() {},
  });
  installGlobal(
    "MutationObserver",
    class {
      observe() {}
    }
  );
  installGlobal("navigator", { userAgent: "node" });
  installGlobal("localStorage", {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  });

  await installParser();
}, 30_000);

function command(buffer: string) {
  return {
    tokens: buffer.split(" ").map((text) => ({ text })),
  };
}

async function parse(buffer: string) {
  const state = await parser.cb(
    command(buffer),
    { currentWorkingDirectory: REPO, currentProcess: "" },
    [{ name: "pnpm", type: "local", path: `${specProject}/` }],
    false
  );
  return parser.nb(state);
}

function commandName(result: { completionObj: SpecNode }) {
  const name = result.completionObj.name;
  return Array.isArray(name) ? name[0] : name;
}

function subcommands(result: { completionObj: SpecNode }) {
  return Object.keys(result.completionObj.subcommands ?? {});
}

function options(result: { completionObj: SpecNode }) {
  return Object.keys(result.completionObj.options ?? {});
}

describe("installed pnpm spec parse", () => {
  it("opens fig subcommands and options through the real parser", async () => {
    const root = await parse("pnpm jobctl ");
    const job = await parse("pnpm jobctl job ");
    const add = await parse("pnpm jobctl job add ");
    const company = await parse("pnpm jobctl company ");
    const board = await parse("pnpm jobctl board ");
    const batch = await parse("pnpm jobctl batch ");

    expect(commandName(root)).toBe("jobctl");
    expect(subcommands(root)).toEqual([
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
    expect(subcommands(job)).toEqual([
      "add",
      "analyze",
      "delete",
      "clean",
      "pinpoint-replay",
      "dedup",
    ]);
    expect(options(add)).toEqual(expect.arrayContaining(["-l", "--link", "-f", "--file"]));
    expect(subcommands(company)).toEqual(["refresh"]);
    expect(subcommands(board)).toEqual(["refresh"]);
    expect(options(batch)).toContain("--submit-only");
    expect([...commands].some((command) => command.includes("jobctl"))).toBe(false);
  }, 30_000);

  it("still lists an ordinary script from package.json", async () => {
    const result = await parse("pnpm lint ");
    const postProcess = result.currentArg?.generators?.[0]?.postProcess;
    const packageText = readFileSync(path.join(REPO, "package.json"), "utf8");

    expect(commandName(result)).toBe("pnpm");
    expect(postProcess).toEqual(expect.any(Function));
    const names = postProcess?.(packageText, ["pnpm"]).flatMap((item) =>
      Array.isArray(item.name) ? item.name : [item.name]
    );
    expect(names).toEqual(expect.arrayContaining(["lint", "typecheck", "jobctl"]));
    expect(names).not.toContain("scan");
  }, 30_000);
});
