import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "openclaw/plugin-sdk/api": path.resolve(
        __dirname,
        "tests/__mocks__/openclaw-plugin-sdk/api.ts",
      ),
      "openclaw/plugin-sdk/types": path.resolve(
        __dirname,
        "tests/__mocks__/openclaw-plugin-sdk/types.ts",
      ),
    },
  },
});
