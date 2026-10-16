import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { testTimeout: 60000, environment: "edge-runtime", server: { deps: { inline: ["convex-test"] } } },
});
