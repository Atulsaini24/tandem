import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Property-based tests run thousands of cases and all files run in parallel,
    // so the 5s default is too tight on a busy machine (CI runners especially).
    testTimeout: 60_000,
  },
});
