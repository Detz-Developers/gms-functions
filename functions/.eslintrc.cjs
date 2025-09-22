module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "/generated/**/*", // Ignore generated files.
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    "linebreak-style": "off",
    "camelcase": "off",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    "object-curly-spacing": ["error", "always"], // allow { a: 1 }
    "max-len": ["warn", { "code": 120 }],        // 120-char lines
    "comma-dangle": ["error", "never"],          // no trailing commas
    "@typescript-eslint/no-explicit-any": "off", // (or "warn")
    "indent": ["error", 2],
    "quotes": ["error", "double"],
    "import/no-unresolved": 0
  },
};

