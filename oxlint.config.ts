import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, react],
  ignorePatterns: core.ignorePatterns,
  overrides: [
    {
      files: ["src/engine.ts", "src/palette.ts"],
      rules: {
        // Seeded PRNG and packed RGB operations require exact 32-bit semantics.
        "no-bitwise": "off",
      },
    },
    {
      files: ["src/engine.ts"],
      rules: {
        // Style dispatch is intentionally centralized to preserve render order.
        complexity: ["error", 60],
        // Replacing signed 32-bit coercion with Math.trunc changes seeded output.
        "unicorn/prefer-math-trunc": "off",
      },
    },
    {
      files: ["src/palette.ts"],
      rules: {
        // Palette modes share one seeded decision tree so random draws stay stable.
        complexity: ["error", 40],
      },
    },
    {
      files: ["src/App.tsx"],
      rules: {
        // App coordinates one public API and UI state graph; cap further growth.
        complexity: ["error", 50],
        // Computed CSS lengths include px units, which Number would reject.
        "unicorn/prefer-number-coercion": "off",
      },
    },
    {
      files: ["src/code.ts"],
      rules: {
        // Each independent URL parameter is one explicit parsing branch.
        complexity: ["error", 30],
      },
    },
    {
      files: ["scripts/**/*.mjs"],
      rules: {
        // Named Node imports keep the build script's small API surface explicit.
        "unicorn/import-style": "off",
      },
    },
  ],
  rules: {
    "func-style": [
      "error",
      "declaration",
      { allowArrowFunctions: true, allowTypeAnnotation: true },
    ],
    "react/only-export-components": ["warn", { allowConstantExport: true }],
    "react/rules-of-hooks": "error",
    "unicorn/filename-case": [
      "error",
      { cases: { camelCase: true, kebabCase: true, pascalCase: true } },
    ],
  },
});
