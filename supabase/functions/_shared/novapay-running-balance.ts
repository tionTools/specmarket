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

export function assignRunningBalances(receipts, movements, dailyBalances) {
  const result = receipts.map((receipt) => ({ ...receipt }))
  const movementsByDate = new Map()

  for (const movement of movements) {
    const date = text(movement?.legacyDate)
    if (!date) continue

    const direction = movement?.direction
    if (direction !== 'credit' && direction !== 'debit') continue

    const amountCents = moneyCents(movement?.amount)
    const timestamp = Date.parse(text(movement?.occurredAt))
    if (amountCents === null || amountCents <= 0 || !Number.isFinite(timestamp)) continue

    movementsByDate.set(date, [
      ...(movementsByDate.get(date) ?? []),
      { movement, amountCents, timestamp, direction },
    ])
  }

  const balanceByAlias = new Map()

  for (const [date, dayMovements] of movementsByDate) {
    const day = dailyBalances.get(date)
    const closingCents = moneyCents(day?.closing)
    if (closingCents === null) continue

    const netMovementCents = dayMovements.reduce(
      (sum, entry) =>
        sum + (entry.direction === 'credit' ? entry.amountCents : -entry.amountCents),
      0,
    )
    const statedOpeningCents = moneyCents(day?.opening)
    const derivedOpeningCents = closingCents - netMovementCents
    const statedOpeningReconciles =
      statedOpeningCents !== null && statedOpeningCents + netMovementCents === closingCents
    let runningCents = statedOpeningReconciles ? statedOpeningCents : derivedOpeningCents

    for (const entry of [...dayMovements].sort((left, right) => left.timestamp - right.timestamp)) {
      runningCents += entry.direction === 'credit' ? entry.amountCents : -entry.amountCents

      if (entry.direction === 'credit') {
        for (const alias of aliases(entry.movement)) {
          balanceByAlias.set(alias, runningCents / 100)
        }
      }
    }
  }

  return result.map((receipt) => {
    for (const alias of aliases(receipt)) {
      if (balanceByAlias.has(alias)) {
        return { ...receipt, balance: balanceByAlias.get(alias) }
      }
    }
    return receipt
  })
}

export function copyKnownBalancesByProviderAlias(receipts, statementReceipts) {
  const balanceByAlias = new Map()
  for (const receipt of statementReceipts) {
    const balance = receipt?.balance
    if (typeof balance !== 'number' || !Number.isFinite(balance)) continue
    for (const alias of aliases(receipt)) balanceByAlias.set(alias, balance)
  }

  return receipts.map((receipt) => {
    for (const alias of aliases(receipt)) {
      if (balanceByAlias.has(alias)) return { ...receipt, balance: balanceByAlias.get(alias) }
    }
    return receipt
  })
}
