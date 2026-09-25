/** Exclude tombstoned marketplace orders before incremental and forced imports. */
export function excludeDeletedMarketplaceOrders<T>(
  orders: T[],
  deletedExternalIds: ReadonlySet<string>,
  externalId: (order: T) => string,
): { orders: T[]; deletedSkipped: number } {
  const importableOrders = orders.filter((order) => !deletedExternalIds.has(externalId(order)))
  return { orders: importableOrders, deletedSkipped: orders.length - importableOrders.length }
}
