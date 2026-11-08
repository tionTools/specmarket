type PromInsertError = { code?: string; message?: string } | null

// Fail closed: handle only the proven external_id race, and only after reading the winner.
export async function recoverConcurrentPromInsert(
  error: PromInsertError,
  readExistingId: () => Promise<string | null>,
): Promise<boolean> {
  if (error?.code !== '23505' || !error.message?.includes('crm_orders_external_id_unique')) {
    return false
  }
  try {
    return Boolean(await readExistingId())
  } catch {
    return false
  }
}
