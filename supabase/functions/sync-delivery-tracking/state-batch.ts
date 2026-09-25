export type TrackingStateUpdate = {
  order_id: string;
  last_checked_at: string;
  last_error: string | null;
  provider: string | null;
  updated_at: string;
  details?: unknown;
};

type WriteResult = { error: { message: string } | null };
type WriteStates = (states: TrackingStateUpdate[]) => Promise<WriteResult>;

export async function upsertTrackingStateBatches(
  states: TrackingStateUpdate[],
  write: WriteStates,
): Promise<number> {
  let failed = 0;
  for (let start = 0; start < states.length; start += 25) {
    const batch = states.slice(start, start + 25);
    const { error } = await write(batch);
    if (!error) continue;
    console.error("Не удалось пакетно сохранить состояние доставок:", error);
    for (const state of batch) {
      const { error: itemError } = await write([state]);
      if (!itemError) continue;
      failed += 1;
      console.error("Не удалось сохранить состояние доставки:", state.order_id, itemError);
    }
  }
  return failed;
}
