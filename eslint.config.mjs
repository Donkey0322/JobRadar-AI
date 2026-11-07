// eslint.config.js

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import prettier from "eslint-config-prettier";

/**
 * Later blocks replace `@typescript-eslint/no-restricted-imports` entirely for
 * the files they match. Each block repeats every ban that still applies.
 * `src/test/architecture.test.ts` resolves `@/`, `@scripts/`, `@github/`, and relative specifiers.
 * It lists `vi.mock`, `require()`, and non-literal `import()`, but those
 * loads are not dependency edges checked by the boundary rules.
 * Static `export … from` is checked here by specifier text.
 */
const scriptsBan = {
  group: [
    "@/scripts",
    "@/scripts/**",
    "@scripts",
    "@scripts/**",
    "**/scripts",
    "**/scripts/**",
  ],
  message: "src must not import scripts",
};

const githubBan = {
  group: ["@github", "@github/**", "**/.github", "**/.github/**"],
  message: "src must not import .github",
};

function modulesBan(message) {
  return {
    group: ["@/modules", "@/modules/**", "**/modules", "**/modules/**"],
    allowTypeImports: true,
    message,
  };
}

const constantsBan = {
  group: ["@/constants", "@/constants/**", "**/constants", "**/constants/**"],
  allowTypeImports: true,
  message: "utils must not import constants",
};

/** Runtime import of `constants/log` only. Other constant modules stay banned. */
const constantsExceptLogBan = {
  regex: "^(?:@/|(?:\\.\\./)+)constants(?:/(?!log(?:\\.[cm]?[jt]s)?$).+)?$",
  allowTypeImports: true,
  message: "utils must not import constants other than constants/log",
};

const employerBan = {
  group: [
    "@/modules/employer",
    "@/modules/employer/**",
    "**/employer",
    "**/employer/**",
  ],
  allowTypeImports: true,
  message: "posting must not import employer",
};

const LOG_EXCEPTION_FILES = [
  "src/utils/ai/index.ts",
  "src/utils/ai/provider/anthropic.ts",
  "src/utils/ai/provider/google.ts",
  "src/utils/ai/provider/openai.ts",
];

function restricted(patterns) {
  return {
    "@typescript-eslint/no-restricted-imports": ["error", { patterns }],
  };
}

export default [
  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    files: ["**/*.ts"],
    // ignore node_modules
    ignores: ["node_modules/**"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": [
        "warn",
        {
          groups: [
            ["^@?\\w"],

            // Longer than `^@?\w`, so these aliases are not sorted as packages.
            ["^@github/", "^@scripts/"],

            // Unanchored: this is what keeps `@/constants/…` ahead of other `@/` imports.
            ["env", "constants"],

            ["^.*\\u0000$"],

            ["^\\u0000"],

            ["^\\.\\.(?!/?$)", "^\\.\\./?$"],

            ["^\\./(?=.*/)(?!/?$)", "^\\.(?!/?$)", "^\\./?$"],
          ],
        },
      ],

      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          fixStyle: "separate-type-imports",
        },
      ],

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  prettier,

  {
    files: ["src/**/*.ts"],
    rules: restricted([scriptsBan, githubBan]),
  },

  {
    files: ["src/utils/**/*.ts"],
    ignores: LOG_EXCEPTION_FILES,
    rules: restricted([
      scriptsBan,
      githubBan,
      modulesBan("utils must not import modules"),
      constantsBan,
    ]),
  },

  {
    files: LOG_EXCEPTION_FILES,
    rules: restricted([
      scriptsBan,
      githubBan,
      modulesBan("utils must not import modules"),
      constantsExceptLogBan,
    ]),
  },

  {
    files: ["src/types/**/*.ts"],
    rules: restricted([
      scriptsBan,
      githubBan,
      modulesBan("types must not import modules"),
    ]),
  },

  {
    files: ["src/constants/**/*.ts"],
    rules: restricted([
      scriptsBan,
      githubBan,
      modulesBan("constants must not import modules"),
    ]),
  },

  {
    files: ["src/modules/posting/**/*.ts"],
    rules: restricted([scriptsBan, githubBan, employerBan]),
  },
];
