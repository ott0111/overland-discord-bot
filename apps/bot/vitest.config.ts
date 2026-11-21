import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Tests run with no generated Prisma Client and no live database.
      // "@prisma/client" resolves to the harmless stub in src/tests, so
      // importing the database layer never throws "did not initialize yet".
      "@prisma/client": path.resolve(root, "src/tests/prisma-stub.ts"),
      // Resolve the shared package to its TypeScript source directly, so
      // tests do not depend on a built workspace package.
      "@overland/shared": path.resolve(root, "../../packages/shared/src/index.ts"),
    },
  },
  test: { include: ["src/tests/**/*.test.ts"] },
});
