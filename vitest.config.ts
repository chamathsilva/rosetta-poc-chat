import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: [
            "apps/api/src/**/*.test.ts",
            "packages/shared/src/**/*.test.ts"
          ]
        }
      },
      {
        test: {
          name: "web",
          environment: "jsdom",
          include: [
            "apps/web/src/**/*.test.ts",
            "apps/web/src/**/*.test.tsx"
          ],
          setupFiles: ["apps/web/test/setup.ts"]
        }
      }
    ]
  }
});
