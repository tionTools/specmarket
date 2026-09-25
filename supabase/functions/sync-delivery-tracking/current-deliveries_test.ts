import { readCurrentDeliveries } from "./current-deliveries.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("current deliveries are read in batches of 25", async () => {
  const sizes: number[] = [];
  const ids = Array.from({ length: 61 }, (_, i) => String(i));
  const current = await readCurrentDeliveries(ids, async (batch) => {
    sizes.push(batch.length);
    return { data: batch.map((id) => ({ id, delivery: { ttn: id } })), error: null };
  });
  assert(sizes.join(",") === "25,25,11", "unexpected request count");
  assert(current.deliveries.size === 61 && current.errors.size === 0, "missing delivery rows");
});

Deno.test("batch failure falls back to individual reads without losing valid rows", async () => {
  const sizes: number[] = [];
  const current = await readCurrentDeliveries(["1", "2", "3"], async (ids) => {
    sizes.push(ids.length);
    if (ids.length > 1) return { data: null, error: { message: "batch error" } };
    if (ids[0] === "2") return { data: null, error: { message: "row error" } };
    return { data: [{ id: ids[0]!, delivery: { ttn: ids[0] } }], error: null };
  });
  assert(sizes.join(",") === "3,1,1,1", "missing per-order fallback");
  assert(current.deliveries.size === 2, "lost successful rows");
  assert(current.errors.get("2") === "row error", "missing failure");
});

Deno.test("missing or deleted order is not treated as an error or fabricated", async () => {
  const current = await readCurrentDeliveries(["missing"], async () => ({ data: [], error: null }));
  assert(!current.deliveries.has("missing"), "fabricated order");
  assert(current.errors.size === 0, "missing order is not a query error");
});

Deno.test("empty queue does not hit the database", async () => {
  const current = await readCurrentDeliveries([], async () => {
    throw new Error("unexpected query");
  });
  assert(current.deliveries.size === 0, "unexpected delivery");
});

Deno.test("thrown batch and single-read errors are captured", async () => {
  const current = await readCurrentDeliveries(["1"], async () => {
    throw new Error("network down");
  });
  assert(current.errors.get("1")?.includes("network down"), "network error was dropped");
});
