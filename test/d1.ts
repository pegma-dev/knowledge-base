import { createCloudflareD1Store } from "@pegma/storage-cloudflare-d1";
import type { Store } from "@pegma/storage-core";
import { Miniflare } from "miniflare";
import { randomUUID } from "node:crypto";
import { onTestFinished } from "vitest";

/** A fixed date supported by the pinned local workerd, not today's date. */
export const D1_COMPATIBILITY_DATE = "2026-07-28";
const cleanupTimeoutMilliseconds = 30_000;

/**
 * One real local D1 database per factory invocation, including multiple stores
 * within the same test. Call only inside a Vitest test; its lifetime owns cleanup.
 */
export async function createD1Store(): Promise<Store> {
  let runtime: Miniflare | undefined;
  let disposal: Promise<void> | undefined;

  const dispose = (): Promise<void> => {
    const current = runtime;
    if (current === undefined) return Promise.resolve();
    disposal ??= Promise.resolve().then(() => current.dispose());
    return disposal;
  };

  // Register before constructing a runtime or awaiting its binding. Calling the
  // factory outside a test fails before it can leave a native process running.
  onTestFinished(dispose, cleanupTimeoutMilliseconds);

  try {
    runtime = new Miniflare({
      modules: true,
      script:
        "export default { fetch() { return new Response(null, { status: 204 }); } };",
      compatibilityDate: D1_COMPATIBILITY_DATE,
      host: "127.0.0.1",
      port: 0,
      cf: false,
      d1Persist: false,
      d1Databases: { DB: randomUUID() },
    });
    const database = await runtime.getD1Database("DB");
    return createCloudflareD1Store({ database });
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Local D1 initialization and cleanup failed",
      );
    }
    throw error;
  }
}
