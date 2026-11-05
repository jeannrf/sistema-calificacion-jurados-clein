import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts", "tests/rules/**/*.test.ts"], testTimeout: 60000 },
});
