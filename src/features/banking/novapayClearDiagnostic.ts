type PostgrestError = {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
}

function field(value: unknown) {
  return typeof value === 'string' && value ? value : '—'
}

export function rollbackPreferenceApplied(value: string | null) {
  return (
    value?.split(',').some((preference) => preference.trim().toLowerCase() === 'tx=rollback') ??
    false
  )
}

export function postgrestDiagnosticMessage(payload: unknown) {
  const error = payload && typeof payload === 'object' ? (payload as PostgrestError) : {}
  return [
    `code: ${field(error.code)}`,
    `message: ${field(error.message)}`,
    `details: ${field(error.details)}`,
    `hint: ${field(error.hint)}`,
  ].join('\n')
}
