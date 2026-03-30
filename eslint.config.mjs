import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "next.config.js",
    "__*.js",
    "_inspect_env.cjs",
    "scripts/**",
  ]),
]);
