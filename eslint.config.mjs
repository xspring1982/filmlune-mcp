// @ts-check

export default [
  {
    ignores: ["node_modules/**", "catalog/**", "docs/verification/**"],
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-constant-binary-expression": "error",
      "no-dupe-else-if": "error",
      "no-fallthrough": "error",
      "no-irregular-whitespace": "error",
      "no-loss-of-precision": "error",
      "no-unreachable": "error",
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-useless-catch": "error"
    },
  },
];
