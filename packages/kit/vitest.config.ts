import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The Worker helpers' tests (src/worker/) run inside a real workerd, with real
// D1, KV and send_email bindings, as cfanalytics' Worker tests do. The test
// Worker is test/worker.ts. The kit's other tests run with `node --test`.
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./test/worker.ts",
      remoteBindings: false,
      miniflare: {
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: { DB: "db", EMPTY_DB: "empty-db" },
        kvNamespaces: { PINGS: "pings" },
        email: {
          send_email: [
            {
              name: "MAIL",
              allowed_destination_addresses: ["owner@example.com", "team@example.com"],
            },
          ],
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    // The run scope keeps everything this run creates, including wrangler's
    // logs, and removes it at the end (src/run-scope.ts).
    globalSetup: ["./test/run-scope.ts"],
    setupFiles: ["./test/setup.ts"],
    // Tests run in a real workerd. A timeout catches hangs, never slowness.
    testTimeout: 120_000,
  },
});
