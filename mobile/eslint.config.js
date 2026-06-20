// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    rules: {
      // The React Compiler is not enabled in this project (no babel-plugin /
      // experiments.reactCompiler). These rules from eslint-plugin-react-hooks v6
      // only describe what the compiler *would* bail on; with the compiler off they
      // are advisory and flag this codebase's deliberate, documented idioms —
      // notably the stable-ref pattern (`ref.current = value` during render, kept
      // current without re-running effects). Turn them off until/unless we adopt the
      // compiler.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
    },
  },
]);
