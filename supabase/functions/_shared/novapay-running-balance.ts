function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function moneyCents(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) : null
}

function aliases(receipt) {
  if (!Array.isArray(receipt?.providerAliases)) return []
  return [...new Set(receipt.providerAliases.map(text).filter(Boolean))]
}

function receiptKey(value) {
  const date = text(value?.legacyDate)
  const occurredAt = text(value?.occurredAt)
  const amountCents = moneyCents(value?.amount)
  if (!date || !occurredAt || amountCents === null) return ''
  return [date, occurredAt, amountCents].join('\u0000')
}

function addIndex(map, key, index) {
  if (!key) return
  map.set(key, [...(map.get(key) ?? []), index])
}

function firstUnassigned(indexes, assigned) {
  if (!Array.isArray(indexes)) return null
  return indexes.find((index) => !assigned.has(index)) ?? null
}

export function assignRunningBalances(receipts, movements, currentBalance) {
  const result = receipts.map((receipt) => ({ ...receipt }))
  const currentCents = moneyCents(currentBalance)
  if (currentCents === null) return result

  const validMovements = []
  for (const movement of movements) {
    const direction = movement?.direction
    if (direction !== 'credit' && direction !== 'debit') continue

    const amountCents = moneyCents(movement?.amount)
    const timestamp = Date.parse(text(movement?.occurredAt))
    if (amountCents === null || amountCents <= 0 || !Number.isFinite(timestamp)) continue

    validMovements.push({ movement, amountCents, timestamp, direction })
  }

  const receiptIndexesByAlias = new Map()
  const receiptIndexesByKey = new Map()
  for (let index = 0; index < result.length; index += 1) {
    const receipt = result[index]
    for (const alias of aliases(receipt)) addIndex(receiptIndexesByAlias, alias, index)
    addIndex(receiptIndexesByKey, receiptKey(receipt), index)
  }

  const assigned = new Set()
  let runningCents = currentCents

  for (const entry of validMovements.sort((left, right) => right.timestamp - left.timestamp)) {
    if (entry.direction === 'credit') {
      let receiptIndex = null
      for (const alias of aliases(entry.movement)) {
        receiptIndex = firstUnassigned(receiptIndexesByAlias.get(alias), assigned)
        if (receiptIndex !== null) break
      }
      if (receiptIndex === null) {
        receiptIndex = firstUnassigned(
          receiptIndexesByKey.get(receiptKey(entry.movement)),
          assigned,
        )
      }
      if (receiptIndex !== null) {
        result[receiptIndex] = { ...result[receiptIndex], balance: runningCents / 100 }
        assigned.add(receiptIndex)
      }
      runningCents -= entry.amountCents
    } else {
      runningCents += entry.amountCents
    }
  }

  return result
}

export function copyKnownBalancesByProviderAlias(receipts, statementReceipts) {
  const balanceByAlias = new Map()
  const balanceByKey = new Map()
  for (const receipt of statementReceipts) {
    const balance = receipt?.balance
    if (typeof balance !== 'number' || !Number.isFinite(balance)) continue
    for (const alias of aliases(receipt)) balanceByAlias.set(alias, balance)
    const key = receiptKey(receipt)
    if (key) balanceByKey.set(key, balance)
  }

  return receipts.map((receipt) => {
    for (const alias of aliases(receipt)) {
      if (balanceByAlias.has(alias)) return { ...receipt, balance: balanceByAlias.get(alias) }
    }
    const key = receiptKey(receipt)
    if (key && balanceByKey.has(key)) return { ...receipt, balance: balanceByKey.get(key) }
    return receipt
  })
}
