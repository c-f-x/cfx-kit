import type { TestEnv } from "./worker.ts";

// The test Worker's bindings (vitest.config.ts) as `env`, and its default
// export as `exports.default`, from cloudflare:workers.
declare global {
  namespace Cloudflare {
    interface Env extends TestEnv {}
    interface GlobalProps {
      mainModule: typeof import("./worker.ts");
    }
  }
}
