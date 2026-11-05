import { readdirSync, readFileSync } from "fs";
import path from "path";
import ts from "typescript";

/**
 * Layer check for the current tree. Edges are resolved with the repo tsconfig,
 * so `@/` and relative specifiers land on the same file. `export … from` is an
 * edge of the barrel, and a named import is also an edge to the file that
 * defines that name.
 *
 * Runtime means the specifier is still an import or re-export after
 * `ts.transpileModule`. `import type` and `export type` are type-only.
 *
 * Not edges: `vi.mock` / `vi.doMock`, `require()`, and `import()` whose argument
 * is not a string literal. A string `import()` is a runtime edge.
 */

export type EdgeKind = "runtime" | "type";

export interface ArchitectureEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface ArchitectureException {
  rule: string;
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface UnrecognizedLoad {
  kind: "vi.mock" | "dynamic import()" | "require()";
  file: string;
  /** Specifier text, or "non-literal" when the call has no string argument. */
  detail: string;
  /** Set when the specifier resolves and would break a layer rule as a real import. */
  rule: string | null;
}

export interface ArchitectureScan {
  edges: ArchitectureEdge[];
  violations: ArchitectureException[];
  unrecognized: UnrecognizedLoad[];
}

const ROOT = path.resolve(import.meta.dirname, "../..");

export function boundaryRule(from: string, to: string, kind: EdgeKind): string | null {
  if (from.startsWith("src/") && to.startsWith("scripts/")) return "src must not import scripts";
  if (kind === "type") return null;

  if (from.startsWith("src/utils/") && to.startsWith("src/modules/"))
    return "utils must not import modules";
  if (from.startsWith("src/types/") && to.startsWith("src/modules/"))
    return "types must not import modules";
  if (from.startsWith("src/constants/") && to.startsWith("src/modules/"))
    return "constants must not import modules";
  if (from.startsWith("src/utils/") && to.startsWith("src/constants/"))
    return "utils must not import constants";
  // employer → posting stays allowed.
  if (from.startsWith("src/modules/posting/") && to.startsWith("src/modules/employer/"))
    return "posting must not import employer";

  return null;
}

interface ScanBase {
  options: ts.CompilerOptions;
  sources: Map<string, string>;
  facts: Map<string, FileFacts>;
  edges: ArchitectureEdge[];
  unrecognized: UnrecognizedLoad[];
  scan: ArchitectureScan;
}

let scanBase: ScanBase | undefined;

function loadScanBase(): ScanBase {
  if (scanBase) return scanBase;

  const options = compilerOptions();
  const sources = new Map<string, string>();

  for (const file of walkSources()) sources.set(file, readFileSync(file, "utf8"));

  const host = resolutionHost(sources);
  const facts = new Map<string, FileFacts>();
  const unrecognized: UnrecognizedLoad[] = [];

  for (const [file, source] of sources) {
    const rel = projectRel(file);
    if (!rel) continue;
    facts.set(rel, inspect(source, file, rel, options, host, unrecognized));
  }

  const edges = collectEdges(facts, options, host);
  const scan = { edges, violations: violationsFor(edges), unrecognized };
  scanBase = { options, sources, facts, edges, unrecognized, scan };
  return scanBase;
}

export function scanArchitecture(extra: Readonly<Record<string, string>> = {}): ArchitectureScan {
  const base = loadScanBase();
  const extras = Object.entries(extra);

  if (extras.length === 0) return base.scan;

  const sources = new Map(base.sources);
  const facts = new Map(base.facts);
  const unrecognized = base.unrecognized.map((item) => ({ ...item }));
  const replaced = new Set<string>();

  for (const [relPath, source] of extras) {
    const file = path.normalize(path.join(ROOT, relPath));
    sources.set(file, source);
    const rel = projectRel(file);
    if (rel) replaced.add(rel);
  }

  const host = resolutionHost(sources);

  for (const rel of replaced) {
    const file = path.normalize(path.join(ROOT, rel));
    const source = sources.get(file);
    if (source === undefined) continue;
    facts.set(rel, inspect(source, file, rel, base.options, host, unrecognized));
  }

  const edges = [
    ...base.edges.filter((edge) => !replaced.has(edge.from)),
    ...collectEdges(facts, base.options, host, replaced),
  ].sort(compareEdge);

  return { edges, violations: violationsFor(edges), unrecognized };
}

export function violationKey(item: ArchitectureException): string {
  return `${item.kind}\t${item.rule}\t${item.from}\t${item.to}`;
}

function compilerOptions(): ts.CompilerOptions {
  const configPath = path.join(ROOT, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) throw new Error(`Cannot read ${configPath}`);
  return ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT).options;
}

function walkSources(): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(full);
    }
  };
  visit(path.join(ROOT, "src"));
  visit(path.join(ROOT, "scripts"));
  return files;
}

function resolutionHost(sources: Map<string, string>): ts.ModuleResolutionHost {
  return {
    fileExists: (file) => sources.has(path.normalize(file)) || ts.sys.fileExists(file),
    readFile: (file) => sources.get(path.normalize(file)) ?? ts.sys.readFile(file),
    directoryExists: ts.sys.directoryExists,
    getCurrentDirectory: () => ROOT,
    getDirectories: ts.sys.getDirectories,
  };
}

function projectRel(file: string): string | null {
  const rel = path.relative(ROOT, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const posix = rel.split(path.sep).join("/");
  if (!posix.startsWith("src/") && !posix.startsWith("scripts/")) return null;
  if (!/\.(?:ts|tsx|mts)$/.test(posix)) return null;
  return posix;
}

interface NameRef {
  exportName: string;
  kind: EdgeKind;
}

interface Clause {
  specifier: string;
  kind: EdgeKind;
  /** Null when the clause loads the module without naming bindings. */
  names: NameRef[] | null;
}

interface Reexport {
  exportName: string;
  specifier: string;
  remoteName: string;
}

interface FileFacts {
  rel: string;
  clauses: Clause[];
  localExports: Set<string>;
  reexports: Reexport[];
  stars: string[];
}

function inspect(
  source: string,
  fileName: string,
  rel: string,
  options: ts.CompilerOptions,
  host: ts.ModuleResolutionHost,
  unrecognized: UnrecognizedLoad[]
): FileFacts {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const kept = runtimeSpecifiers(source, fileName);
  const facts: FileFacts = {
    rel,
    clauses: [],
    localExports: new Set(),
    reexports: [],
    stars: [],
  };
  const imported = new Map<string, { specifier: string; exportName: string }>();

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
      readImport(node, facts, imported, kept);
    } else if (ts.isExportDeclaration(node)) {
      readExport(node, facts, imported, kept);
    } else if (ts.isExportAssignment(node) && !node.isExportEquals) {
      facts.localExports.add("default");
    } else if (isRuntimeExport(node)) {
      collectExportedDeclaration(node, facts.localExports);
    } else if (ts.isCallExpression(node)) {
      readCall(node, rel, facts, options, host, unrecognized);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return facts;
}

function readImport(
  node: ts.ImportDeclaration,
  facts: FileFacts,
  imported: Map<string, { specifier: string; exportName: string }>,
  kept: Set<string>
) {
  const specifier = literalSpecifier(node.moduleSpecifier);
  if (!specifier) return;
  const typeOnly = node.importClause?.isTypeOnly ?? false;
  const names: NameRef[] = [];

  const clause = node.importClause;
  if (!clause) {
    facts.clauses.push({
      specifier,
      kind: moduleKind(specifier, typeOnly, null, kept),
      names: null,
    });
    return;
  }
  if (clause.name) {
    imported.set(clause.name.text, { specifier, exportName: "default" });
    names.push({ exportName: "default", kind: typeOnly ? "type" : "runtime" });
  }
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      const exportName = element.propertyName?.text ?? element.name.text;
      imported.set(element.name.text, { specifier, exportName });
      names.push({ exportName, kind: typeOnly || element.isTypeOnly ? "type" : "runtime" });
    }
  }
  const wholeModule = Boolean(bindings && ts.isNamespaceImport(bindings));
  facts.clauses.push({
    specifier,
    kind: moduleKind(specifier, typeOnly, wholeModule ? null : names, kept),
    names: wholeModule ? null : names,
  });
}

function readExport(
  node: ts.ExportDeclaration,
  facts: FileFacts,
  imported: Map<string, { specifier: string; exportName: string }>,
  kept: Set<string>
) {
  const specifier = node.moduleSpecifier ? literalSpecifier(node.moduleSpecifier) : null;

  if (!node.exportClause) {
    if (!specifier) return;
    facts.stars.push(specifier);
    facts.clauses.push({
      specifier,
      kind: moduleKind(specifier, node.isTypeOnly, null, kept),
      names: null,
    });
    return;
  }

  if (ts.isNamespaceExport(node.exportClause)) {
    facts.localExports.add(node.exportClause.name.text);
    if (specifier) {
      facts.clauses.push({
        specifier,
        kind: moduleKind(specifier, node.isTypeOnly, null, kept),
        names: null,
      });
    }
    return;
  }

  const names: NameRef[] = [];
  for (const element of node.exportClause.elements) {
    const exported = element.name.text;
    const local = element.propertyName
      ? ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : "default"
      : exported;
    const nameKind = node.isTypeOnly || element.isTypeOnly ? "type" : "runtime";

    if (specifier) {
      facts.reexports.push({ exportName: exported, specifier, remoteName: local });
      names.push({ exportName: exported, kind: nameKind });
    } else {
      const binding = imported.get(local);
      if (binding) {
        facts.reexports.push({
          exportName: exported,
          specifier: binding.specifier,
          remoteName: binding.exportName,
        });
      } else {
        facts.localExports.add(exported);
      }
    }
  }
  if (specifier) {
    facts.clauses.push({
      specifier,
      kind: moduleKind(specifier, node.isTypeOnly, names, kept),
      names,
    });
  }
}

function readCall(
  node: ts.CallExpression,
  rel: string,
  facts: FileFacts,
  options: ts.CompilerOptions,
  host: ts.ModuleResolutionHost,
  unrecognized: UnrecognizedLoad[]
) {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const arg = node.arguments[0];
    if (arg && ts.isStringLiteral(arg)) {
      facts.clauses.push({ specifier: arg.text, kind: "runtime", names: null });
    } else {
      unrecognized.push({ kind: "dynamic import()", file: rel, detail: "non-literal", rule: null });
    }
    return;
  }

  if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
    const arg = node.arguments[0];
    unrecognized.push({
      kind: "require()",
      file: rel,
      detail: arg && ts.isStringLiteral(arg) ? arg.text : "non-literal",
      rule: null,
    });
    return;
  }

  if (!isViMock(node.expression)) return;
  const arg = node.arguments[0];
  const detail = arg && ts.isStringLiteral(arg) ? arg.text : "non-literal";
  let rule: string | null = null;
  if (arg && ts.isStringLiteral(arg)) {
    const resolved = resolveSpecifier(arg.text, rel, options, host);
    if (resolved) rule = boundaryRule(rel, resolved, "runtime");
  }
  unrecognized.push({ kind: "vi.mock", file: rel, detail, rule });
}

function isViMock(expr: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expr) &&
    (expr.name.text === "mock" || expr.name.text === "doMock") &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "vi"
  );
}

/**
 * A specifier that survives transpile is runtime. `import type` / `export type`
 * do not survive. An unused value import is erased too, but it still loads the
 * module, so a value binding counts as runtime even when the emit drops it.
 */
function moduleKind(
  specifier: string,
  typeOnly: boolean,
  names: NameRef[] | null,
  kept: Set<string>
): EdgeKind {
  if (kept.has(specifier)) return "runtime";
  if (typeOnly) return "type";
  if (!names || names.some((name) => name.kind === "runtime")) return "runtime";
  return "type";
}

function literalSpecifier(node: ts.Expression): string | null {
  return ts.isStringLiteral(node) ? node.text : null;
}

function isRuntimeExport(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isVariableStatement(node)
  );
}

function collectExportedDeclaration(node: ts.Node, localExports: Set<string>) {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return;
  if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
    localExports.add("default");
  }
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      bindingNames(declaration.name, localExports);
    }
    return;
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    if (node.name && ts.isIdentifier(node.name)) localExports.add(node.name.text);
  }
}

function bindingNames(name: ts.BindingName, out: Set<string>) {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) bindingNames(element.name, out);
  }
}

function runtimeSpecifiers(source: string, fileName: string): Set<string> {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
  }).outputText;
  const sf = ts.createSourceFile(fileName, output, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const specifiers = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specifiers;
}

function collectEdges(
  facts: Map<string, FileFacts>,
  options: ts.CompilerOptions,
  host: ts.ModuleResolutionHost,
  onlyFrom?: ReadonlySet<string>
): ArchitectureEdge[] {
  const edges = new Map<string, ArchitectureEdge>();
  const add = (from: string, to: string, kind: EdgeKind) => {
    if (from === to) return;
    const key = `${from}\t${to}\t${kind}`;
    edges.set(key, { from, to, kind });
  };

  for (const file of facts.values()) {
    if (onlyFrom && !onlyFrom.has(file.rel)) continue;
    const merged = mergeClauses(file.clauses);
    for (const [specifier, clause] of merged) {
      const resolved = resolveSpecifier(specifier, file.rel, options, host);
      if (!resolved) continue;
      add(file.rel, resolved, clause.kind);
      if (!clause.names) continue;
      for (const name of clause.names) {
        const origin = exportOrigin(resolved, name.exportName, facts, options, host, new Set());
        if (origin) add(file.rel, origin, name.kind);
      }
    }
  }

  return [...edges.values()].sort(compareEdge);
}

function mergeClauses(clauses: Clause[]): Map<string, { kind: EdgeKind; names: NameRef[] | null }> {
  const merged = new Map<string, { kind: EdgeKind; names: NameRef[] | null }>();
  for (const clause of clauses) {
    const current = merged.get(clause.specifier) ?? {
      kind: "type" as EdgeKind,
      names: [] as NameRef[],
    };
    if (clause.kind === "runtime") current.kind = "runtime";
    if (clause.names === null) current.names = null;
    else if (current.names) {
      for (const name of clause.names) {
        const previous = current.names.find((item) => item.exportName === name.exportName);
        if (!previous) current.names.push(name);
        else if (name.kind === "runtime") previous.kind = "runtime";
      }
    }
    merged.set(clause.specifier, current);
  }
  return merged;
}

function exportOrigin(
  file: string,
  name: string,
  facts: Map<string, FileFacts>,
  options: ts.CompilerOptions,
  host: ts.ModuleResolutionHost,
  seen: Set<string>
): string | null {
  const mark = `${file}#${name}`;
  if (seen.has(mark)) return null;
  seen.add(mark);
  const info = facts.get(file);
  if (!info) return null;
  if (info.localExports.has(name)) return file;

  const reexport = info.reexports.find((item) => item.exportName === name);
  if (reexport) {
    const next = resolveSpecifier(reexport.specifier, file, options, host);
    if (!next) return null;
    return exportOrigin(next, reexport.remoteName, facts, options, host, seen) ?? next;
  }

  if (name === "default") return null;
  for (const specifier of info.stars) {
    const next = resolveSpecifier(specifier, file, options, host);
    if (!next) continue;
    const found = exportOrigin(next, name, facts, options, host, seen);
    if (found) return found;
  }
  return null;
}

function resolveSpecifier(
  specifier: string,
  fromRel: string,
  options: ts.CompilerOptions,
  host: ts.ModuleResolutionHost
): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  const fromFile = path.join(ROOT, fromRel);
  const resolved = ts.resolveModuleName(specifier, fromFile, options, host).resolvedModule;
  if (!resolved) throw new Error(`Cannot resolve ${specifier} from ${fromRel}`);
  return projectRel(resolved.resolvedFileName);
}

function violationsFor(edges: ArchitectureEdge[]): ArchitectureException[] {
  const violations: ArchitectureException[] = [];
  for (const edge of edges) {
    const rule = boundaryRule(edge.from, edge.to, edge.kind);
    if (!rule) continue;
    violations.push({ rule, from: edge.from, to: edge.to, kind: edge.kind });
  }
  return violations.sort(compareEdge);
}

function compareEdge(a: ArchitectureEdge | ArchitectureException, b: typeof a): number {
  return violationKey({ ...a, rule: "rule" in a ? a.rule : "" }).localeCompare(
    violationKey({ ...b, rule: "rule" in b ? b.rule : "" })
  );
}
