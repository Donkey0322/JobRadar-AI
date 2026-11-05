/**
 * Expected menus for `pnpm <script>`. The installed app does not call this
 * function. The spec patch in `pnpm-spec-patch.ts` is what Easy Complete loads.
 */

type FigNode = {
  name?: string | string[];
  description?: string;
  subcommands?: FigNode[];
  options?: FigNode[];
  args?: unknown;
  isRepeatable?: boolean;
  exclusiveOn?: string[];
};

type PackageFig = {
  scripts?: Record<string, string>;
  fig?: Record<string, FigNode>;
};

function nodeNames(node: FigNode) {
  if (Array.isArray(node.name)) return node.name;
  return node.name ? [node.name] : [];
}

function findNode(nodes: FigNode[] | undefined, token: string) {
  return nodes?.find((node) => nodeNames(node).includes(token));
}

function scriptSuggestions(scripts: Record<string, string>, fig: Record<string, FigNode>) {
  return Object.entries(scripts).map(([name, description]) => ({
    name,
    description,
    ...fig[name],
  }));
}

function visibleOptions(node: FigNode, used: Set<string>) {
  return (node.options ?? []).filter((option) => {
    const names = nodeNames(option);

    if (!option.isRepeatable && names.some((name) => used.has(name))) return false;
    if (option.exclusiveOn?.some((name) => used.has(name))) return false;

    return true;
  });
}

function childSuggestions(node: FigNode, tokens: string[]): FigNode[] {
  const used = new Set<string>();
  let current = node;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const subcommand = findNode(current.subcommands, token);

    if (subcommand) {
      current = subcommand;
      continue;
    }

    const option = findNode(current.options, token);

    if (option) {
      for (const name of nodeNames(option)) used.add(name);
      const next = tokens[index + 1];

      if (option.args && next && !next.startsWith("-")) index += 1;
      continue;
    }

    if (current.args) continue;

    break;
  }

  if (current.subcommands?.length) return current.subcommands;
  return visibleOptions(current, used);
}

/** Suggestions for a pnpm buffer, including the trailing empty cursor token. */
export function completePnpm(packageText: string, tokens: string[]): FigNode[] {
  const parsed = JSON.parse(packageText) as PackageFig;
  const scripts = parsed.scripts ?? {};
  const fig = parsed.fig ?? {};
  const words = tokens.filter((token) => token.length > 0);
  const script = words[1];

  if (!script || !(script in scripts)) return scriptSuggestions(scripts, fig);

  const command = fig[script];

  if (!command) return scriptSuggestions(scripts, fig);

  return childSuggestions(command, words.slice(2));
}
