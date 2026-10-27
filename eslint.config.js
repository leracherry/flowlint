import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "demo-output/**",
      "producer-check/**",
    ],
  },
  ...tseslint.configs.recommended,
);
