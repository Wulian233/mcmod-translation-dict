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
      "no-undef": "warn",
      "no-unused-vars": "warn",
      "semi": ["error", "always"],
    },
  },
];
