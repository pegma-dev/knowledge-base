import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    globalSetup: ["./test/azurite.ts"],
    maxWorkers: 4,
    testTimeout: 180_000,
    hookTimeout: 30_000,
  },
});
