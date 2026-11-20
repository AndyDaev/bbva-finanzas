import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "functions/**/*.test.js"],
    environment: "node",
    // The first render test compiles every SFC cold; give it room on slow machines.
    testTimeout: 20_000,
  },
})
