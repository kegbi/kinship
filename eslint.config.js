import astro from "eslint-plugin-astro";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import typescriptParser from "@typescript-eslint/parser";

// Deno lint covers TypeScript and TSX in general; ESLint adds what it cannot
// express: Astro templates, their accessibility preset, and, for the React
// islands of ADR 0006, the hooks rules and the same accessibility preset.
const islandSources = [
  "apps/web/src/islands/**/*.{ts,tsx}",
  "apps/web/src/features/**/*.{ts,tsx}",
  "apps/web/src/components/ui/**/*.tsx",
  // The suites' shared island test support (GAP-030) renders islands too.
  "apps/web/src/testing/**/*.{ts,tsx}",
];

export default [
  { ignores: ["apps/web/dist/**", ".artifacts/**", ".coverage/**"] },
  ...astro.configs["flat/recommended"],
  ...astro.configs["flat/jsx-a11y-recommended"],
  {
    files: islandSources,
    languageOptions: {
      parser: typescriptParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  { ...reactHooks.configs.flat.recommended, files: islandSources },
  // The Astro accessibility preset already registers the jsx-a11y plugin for
  // every file, so the islands add the plugin's own recommended rules.
  {
    files: ["apps/web/src/**/*.tsx"],
    rules: jsxA11y.flatConfigs.recommended.rules,
  },
];
