import { defineConfig } from "vitest/config";

// bcrypt (cost 12) and an in-memory MongoDB make some auth tests take a few seconds on a busy laptop.
export default defineConfig({ test: { testTimeout: 20000, hookTimeout: 60000 } });
