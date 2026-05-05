import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/__tests__/helpers/setup-env.ts"],
    // Sequential execution so all tests share the worker-scoped temp DB
    // and don't fight over its state.
    fileParallelism: false,
  },
});
