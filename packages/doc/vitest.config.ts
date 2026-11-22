import { defineConfig } from "vitest/config";

// Resolve workspace packages to their TypeScript source, so tests need no prior build.
const conditions = ["source", "module", "node", "development|production"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: { testTimeout: 60_000 },
});
