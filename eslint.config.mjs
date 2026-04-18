// eslint.config.js

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import prettier from "eslint-config-prettier";

export default [
  // 基本 JS 推薦規則
  js.configs.recommended,

  // TypeScript 推薦規則
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

            ["env", "constants"],

            ["^.*\\u0000$"],

            [
              "^(components|context|hooks|icons|layout|lib|modules|services|shared|theme|utils)(/.*|$)",
            ],

            ["^\\u0000"],

            ["^\\.\\.(?!/?$)", "^\\.\\./?$"],

            ["^\\./(?=.*/)(?!/?$)", "^\\.(?!/?$)", "^\\./?$"],

            ["^.+\\.s?css$"],

            ["^(static)(/.*|$)"],
          ],
        },
      ],

      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          fixStyle: "separate-type-imports",
        },
      ],
    },
  },

  // 🔥 關閉所有會跟 Prettier 衝突的規則
  prettier,
];
