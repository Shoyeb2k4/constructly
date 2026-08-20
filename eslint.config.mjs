import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    // Demo preview build output — same artifact as `.next/`, different folder.
    ".next-demo/**",
    // Native shells. `mobile/dist` and `ios/App/public` are BUNDLED web output
    // copied in by the Capacitor build, so linting them reports thousands of
    // problems in minified vendor code and buries every real one.
    "mobile/dist/**",
    "mobile/node_modules/**",
    "ios/**",
  ]),
]);

export default eslintConfig;
