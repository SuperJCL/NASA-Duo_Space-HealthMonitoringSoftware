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
    // HUD teammate's sub-project (feat/myomars-hud, merged on integration/myomars): its own code
    // style and test suites (myomars-hud/test); only integration compat patches are made there.
    "myomars-hud/**",
    // Generated copy of the HUD page for the online demo (scripts/copy-hud.mjs).
    "public/hud/**",
    // Generated static site of the separate FlexArray patch demo (myomars-flexarray-demo/scripts/build-site.mjs).
    "myomars-flexarray-demo/site/**",
  ]),
]);

export default eslintConfig;
