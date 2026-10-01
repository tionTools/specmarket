import type { SupabaseClient } from '@supabase/supabase-js'

const remoteOrdersPageSize = 200

export type OrderItemReturnRow = {
  order_id: string
  item_position: number
  product_name: string
  returned_quantity: number
  returned_at: string | null
}

export function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size))
  }
  return result
}

export async function fetchAllRemoteOrderVersions(client: SupabaseClient) {
  const rows: Array<{ id: string; updated_at: string }> = []
  let lastId = ''
  while (true) {
    let query = client
      .from('crm_orders')
      .select('id, updated_at')
      .order('id', { ascending: true })
      .limit(remoteOrdersPageSize)
    if (lastId) query = query.gt('id', lastId)
    const { data, error } = await query
    if (error) return { rows: null, error }

    const page = (data ?? []).map((row) => ({
      id: String(row.id),
      updated_at: String(row.updated_at),
    }))
    rows.push(...page)
    if (page.length < remoteOrdersPageSize) return { rows, error: null }

    lastId = page.at(-1)?.id ?? ''
    if (!lastId) return { rows, error: null }
  }
}

export async function fetchAllRemoteOrderRows(client: SupabaseClient) {
  const rows: Array<Record<string, unknown>> = []
  let lastId = ''
  while (true) {
    let query = client
      .from('crm_orders')
      .select('*, crm_order_items(*)')
      .order('id', { ascending: true })
      .limit(remoteOrdersPageSize)
    if (lastId) query = query.gt('id', lastId)
    const { data, error } = await query
    if (error) return { rows: null, error }

    const page = (data ?? []) as Array<Record<string, unknown>>
    rows.push(...page)
    if (page.length < remoteOrdersPageSize) return { rows, error: null }

    lastId = String(page.at(-1)?.id ?? '')
    if (!lastId) return { rows, error: null }
  }
}

export async function fetchAllOrderItemReturns(client: SupabaseClient) {
  const rows: OrderItemReturnRow[] = []
  for (let offset = 0; ; offset += remoteOrdersPageSize) {
    const { data, error } = await client
      .from('crm_order_item_returns')
      .select('order_id, item_position, product_name, returned_quantity, returned_at')
      .order('order_id', { ascending: true })
      .order('item_position', { ascending: true })
      .range(offset, offset + remoteOrdersPageSize - 1)
    if (error) return { rows: null, error }

    const page = (data ?? []).map((row) => ({
      order_id: String(row.order_id),
      item_position: Number(row.item_position),
      product_name: String(row.product_name),
      returned_quantity: Number(row.returned_quantity),
      returned_at: row.returned_at === null ? null : String(row.returned_at),
    }))
    rows.push(...page)
    if (page.length < remoteOrdersPageSize) return { rows, error: null }
  }
}
