import globals from "globals";

export default [
  {
    ignores: ["**/.wrangler/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        bootstrap: "readonly",
      },
    },
    rules: {
      "no-debugger": "error",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-extra-boolean-cast": "error",

      "no-var": "error",
      "prefer-const": "warn",
      "no-undef": "warn",

      "semi": ["error", "always"],
      "quotes": ["error", "double", { avoidEscape: true }],
      "indent": ["error", 2, { SwitchCase: 1 }],
      "comma-dangle": ["error", "only-multiline"],
      "object-curly-spacing": ["error", "always"],
      "array-bracket-spacing": ["error", "never"],
      "space-before-function-paren": ["error", "never"],
      "keyword-spacing": ["error", { before: true, after: true }],
      "brace-style": ["error", "1tbs", { allowSingleLine: true }],
    },
  },
];
