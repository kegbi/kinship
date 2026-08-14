import astro from "eslint-plugin-astro";

export default [
  { ignores: ["apps/web/dist/**", ".artifacts/**", ".coverage/**"] },
  ...astro.configs["flat/recommended"],
  ...astro.configs["flat/jsx-a11y-recommended"],
];
