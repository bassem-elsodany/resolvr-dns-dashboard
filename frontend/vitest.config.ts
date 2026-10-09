import { defineConfig, mergeConfig } from "vitest/config"
import viteConfig from "./vite.config"

// Extends the app's own Vite config, so build-time constants such as
// __APP_VERSION__ are defined in tests exactly as they are in the build.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: false,
    },
  }),
)
