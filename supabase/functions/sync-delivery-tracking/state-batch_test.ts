import { type TrackingStateUpdate, upsertTrackingStateBatches } from "./state-batch.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fixture(count: number): TrackingStateUpdate[] {
  return Array.from({ length: count }, (_, index) => ({
    order_id: String(index),
    last_checked_at: "2026-09-25T10:00:00Z",
    last_error: null,
    provider: "nova",
    details: null,
    updated_at: "2026-09-25T10:00:00Z",
  }));
}

Deno.test("batching replaces individual state writes with groups of 25", async () => {
  const sizes: number[] = [];
  const failed = await upsertTrackingStateBatches(fixture(61), async (states) => {
    sizes.push(states.length);
    return { error: null };
  });
  assert(failed === 0, "unexpected state-write failure");
  assert(sizes.join(",") === "25,25,11", "state writes are not batched correctly");
});

Deno.test("a rejected batch falls back to individual writes without losing other rows", async () => {
  const sizes: number[] = [];
  const failed = await upsertTrackingStateBatches(fixture(3), async (states) => {
    sizes.push(states.length);
    if (states.length > 1 || states[0]?.order_id === "1") {
      return { error: { message: "test write failure" } };
    }
    return { error: null };
  });
  assert(sizes.join(",") === "3,1,1,1", "batch fallback did not retry each row");
  assert(failed === 1, "only the failing row should be counted");
});

Deno.test("empty queue does not perform a database request", async () => {
  const failed = await upsertTrackingStateBatches([], async () => {
    throw new Error("unexpected request");
  });
  assert(failed === 0, "empty queue failed");
});
