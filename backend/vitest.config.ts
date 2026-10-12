import { defineConfig } from "vitest/config";

// Keep the test output readable: the app logs sign-ins, admin actions and one
// line per request, which the tests do not need to see. Warnings stay on so
// the tests that check them still see them.
export default defineConfig({ test: { env: { LOG_LEVEL: "warn" } } });
