import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["./test/database-guard.ts"], fileParallelism: false },
});
