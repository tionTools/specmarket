export type CurrentDeliveryRow = { id: string; delivery: unknown };
type ReadResult = { data: CurrentDeliveryRow[] | null; error: { message: string } | null };
type ReadBatch = (ids: string[]) => Promise<ReadResult>;

export async function readCurrentDeliveries(ids: string[], read: ReadBatch) {
  const deliveries = new Map<string, unknown>();
  const errors = new Map<string, string>();
  for (let start = 0; start < ids.length; start += 25) {
    const batch = ids.slice(start, start + 25);
    let result: ReadResult;
    try {
      result = await read(batch);
    } catch (error) {
      result = { data: null, error: { message: String(error) } };
    }
    if (!result.error) {
      for (const row of result.data ?? []) deliveries.set(row.id, row.delivery);
      continue;
    }
    console.error("Не удалось пакетно прочитать актуальные доставки:", result.error);
    for (const id of batch) {
      try {
        const item = await read([id]);
        if (item.error) {
          errors.set(id, item.error.message);
        } else {
          for (const row of item.data ?? []) deliveries.set(row.id, row.delivery);
        }
      } catch (error) {
        errors.set(id, String(error));
      }
    }
  }
  return { deliveries, errors };
}
