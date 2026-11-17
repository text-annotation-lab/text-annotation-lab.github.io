// Lint for the Lab's stack (Vite, React, TypeScript). The Lab is not a Next.js app, so the Next.js presets,
// whose parser needs Next.js itself, are not used.
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default defineConfig([
  globalIgnores(["dist/**", "node_modules/**", "vendor/**", "public/**"]),
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",
      // The code base uses `any` for provider replies and stored records on purpose.
      "@typescript-eslint/no-explicit-any": "off",
      // Reported, not failing: older code leaves some names unused and writes `a && b()` as a statement.
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "prefer-const": "warn",
    },
  },
  {
    files: ["**/*.{cjs,js,mjs}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
    },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0.
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);
