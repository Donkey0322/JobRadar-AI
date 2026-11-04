import type { ArchitectureException } from "./architecture";

/**
 * File-to-file exceptions for edges that already break the layer rules.
 * Delete an entry when that import disappears. Do not add one.
 */
export const architectureExceptions: readonly ArchitectureException[] = [
  {
    rule: "utils must not import constants",
    from: "src/utils/ai/index.ts",
    to: "src/constants/log.ts",
    kind: "runtime",
  },
  {
    rule: "utils must not import constants",
    from: "src/utils/ai/provider/anthropic.ts",
    to: "src/constants/log.ts",
    kind: "runtime",
  },
  {
    rule: "utils must not import constants",
    from: "src/utils/ai/provider/google.ts",
    to: "src/constants/log.ts",
    kind: "runtime",
  },
  {
    rule: "utils must not import constants",
    from: "src/utils/ai/provider/openai.ts",
    to: "src/constants/log.ts",
    kind: "runtime",
  },
];
