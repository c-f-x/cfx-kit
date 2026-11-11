import path from "node:path";
import { openRunScope } from "../src/run-scope.ts";

// Vitest global setup: the Worker test run's own scope. Wrangler and the
// Workers test pool write their logs inside it instead of the shared folder in
// the home directory, and the scope is removed when the run ends. Ported from
// cfanalytics:scripts/lib/vitest-run-scope.mjs.
export default function setup(): () => Promise<void> {
  const scope = openRunScope({ installExitHandlers: true });
  process.env.WRANGLER_LOG_PATH = path.join(scope.dir, "wrangler-logs");
  return async () => {
    const { leftovers } = await scope.close();
    if (leftovers.length > 0)
      throw new Error(`The test run left things behind: ${leftovers.join(", ")}`);
  };
}
