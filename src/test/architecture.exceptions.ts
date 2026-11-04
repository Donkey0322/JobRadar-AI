import type { ArchitectureException } from "./architecture";

/**
 * File-to-file exceptions for edges that already break the layer rules.
 * Delete an entry when that import disappears. Do not add one.
 */
export const architectureExceptions: readonly ArchitectureException[] = [
  {
    rule: "constants must not import validation",
    from: "src/constants/index.ts",
    to: "src/validation/config.ts",
    kind: "runtime",
  },
  {
    rule: "utils must not import constants",
    from: "src/utils/ai/enabled.ts",
    to: "src/constants/index.ts",
    kind: "runtime",
  },
  {
    rule: "utils must not import constants",
    from: "src/utils/ai/index.ts",
    to: "src/constants/index.ts",
    kind: "runtime",
  },
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
  {
    rule: "utils must not import constants",
    from: "src/utils/ai/provider/utils.ts",
    to: "src/constants/index.ts",
    kind: "runtime",
  },
  {
    rule: "utils must not import constants",
    from: "src/utils/data.ts",
    to: "src/constants/index.ts",
    kind: "runtime",
  },
  {
    rule: "utils must not import constants",
    from: "src/utils/data.ts",
    to: "src/constants/log.ts",
    kind: "runtime",
  },
  {
    rule: "validation must not import constants",
    from: "src/validation/ai.ts",
    to: "src/constants/country.ts",
    kind: "runtime",
  },
  {
    rule: "validation must not import constants",
    from: "src/validation/ai.ts",
    to: "src/constants/index.ts",
    kind: "runtime",
  },
  {
    rule: "validation must not import constants",
    from: "src/validation/ai.ts",
    to: "src/constants/season.ts",
    kind: "runtime",
  },
  {
    rule: "validation must not import constants",
    from: "src/validation/config.ts",
    to: "src/constants/country.ts",
    kind: "runtime",
  },
  {
    rule: "validation must not import constants",
    from: "src/validation/season.ts",
    to: "src/constants/index.ts",
    kind: "runtime",
  },
  {
    rule: "validation must not import constants",
    from: "src/validation/season.ts",
    to: "src/constants/season.ts",
    kind: "runtime",
  },
];
