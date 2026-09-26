const LOCK_LEASE_SECONDS = 90
const LOCK_WAIT_ATTEMPTS = 121
const LOCK_WAIT_MS = 250
// Six SOAP calls with a 20s timeout and one retry each: 240s + 60s headroom.
const JWT_SAFETY_MARGIN_MS = 300_000
const AUTH_STATE_SAVE_ATTEMPTS = 2
const AUTH_STATE_SAVE_RETRY_MS = 250
const AUTH_FINGERPRINT_HEX_LENGTH = 16

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class NovaPayAuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public reason?: string,
  ) {
    super(message)
    this.name = 'NovaPayAuthError'
  }
}

export class NovaPayTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NovaPayTransportError'
  }
}

async function credentialFingerprint(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, AUTH_FINGERPRINT_HEX_LENGTH)
}

async function credentialFingerprints(state: { refreshToken: string; publicCertificate: string }) {
  const [refresh, certificate] = await Promise.all([
    credentialFingerprint(state.refreshToken),
    credentialFingerprint(state.publicCertificate),
  ])
  return { refresh, certificate }
}

function jwtExpiryMs(jwt: string): number | null {
  const payload = jwt.split('.')[1]
  if (!payload) return null
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    const json = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
    const exp = JSON.parse(json)?.exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null
  } catch {
    return null
  }
}

interface NovaPayAdmin {
  rpc(
    name: string,
    args?: Record<string, string | number>,
  ): PromiseLike<{
    data?: Record<string, unknown> | boolean | null
    error?: { code?: string; message?: string } | null
  }>
}

async function acquireRotationLock(admin: NovaPayAdmin, owner: string) {
  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    const { data, error } = await admin.rpc('acquire_novapay_rotation_lock_owned', {
      lock_owner: owner,
      lease_seconds: LOCK_LEASE_SECONDS,
    })
    if (error?.code === 'NP002') {
      throw new NovaPayAuthError(
        409,
        'NOVAPAY_AUTH_RECOVERY_REQUIRED',
        'NovaPay authorization is blocked. Install a fresh credential pair and manually reset the recovery flag.',
      )
    }
    if (error)
      throw new NovaPayAuthError(
        500,
        'NOVAPAY_LOCK_FAILED',
        'Failed to acquire NovaPay authorization lock.',
      )
    if (data === true) return
    if (attempt + 1 < LOCK_WAIT_ATTEMPTS) await sleep(LOCK_WAIT_MS)
  }
  throw new NovaPayAuthError(
    409,
    'NOVAPAY_AUTH_BUSY',
    'NovaPay authorization is busy. Retry shortly.',
  )
}

function ambiguousAuthenticationError(error: unknown) {
  if (error instanceof NovaPayTransportError) return true
  if (!error || typeof error !== 'object') return false
  const code = text((error as { code?: unknown }).code)
  return code === 'NOVAPAY_SOAP_PARSE_ERROR' || code === 'NOVAPAY_SOAP_RESULT_MISSING'
}

function authExchangeFailureReason(error: unknown): string {
  if (error instanceof NovaPayTransportError) {
    if (error.message === 'AbortError') return 'timeout'
    if (/^http_[45][0-9]{2}$/.test(error.message)) return error.message
    return 'transport_failure'
  }
  const code =
    error && typeof error === 'object' ? text((error as { code?: unknown }).code) : ''
  if (
    code === 'NOVAPAY_SOAP_PARSE_ERROR' ||
    code === 'NOVAPAY_SOAP_RESULT_MISSING' ||
    code === 'NOVAPAY_SOAP_FAULT' ||
    code === 'NOVAPAY_API_ERROR'
  )
    return code
  return 'unexpected_error'
}

async function authenticateOnce(
  authenticate: (state: { refreshToken: string; publicCertificate: string }) => Promise<unknown>,
  state: { refreshToken: string; publicCertificate: string },
) {
  try {
    return await authenticate(state)
  } catch (error) {
    // A single-use refresh credential may be consumed even if its response is lost.
    // Never log raw provider errors: they may contain credentials or response payloads.
    console.error(
      `NovaPay JWT rotation failed: reason=${authExchangeFailureReason(error)}; recovery_guard=retained.`,
    )
    if (!ambiguousAuthenticationError(error)) throw error
    throw new NovaPayAuthError(
      502,
      'NOVAPAY_AUTH_UNCERTAIN',
      'NovaPay may have rotated credentials, but its response was unavailable. Authorization was not retried; verify authorization state before trying again.',
      authExchangeFailureReason(error),
    )
  }
}

async function saveRotatedAuthState(admin: NovaPayAdmin, state: Record<string, string>) {
  for (let attempt = 0; attempt < AUTH_STATE_SAVE_ATTEMPTS; attempt += 1) {
    let failed = true
    try {
      const { error } = await admin.rpc('save_novapay_auth_state_owned', state)
      if (error?.code === 'NP001') {
        throw new NovaPayAuthError(
          409,
          'NOVAPAY_AUTH_LOCK_LOST',
          'NovaPay authorization lock was lost; credentials were not overwritten.',
        )
      }
      failed = Boolean(error)
    } catch (error) {
      if (error instanceof NovaPayAuthError) throw error
      failed = true
    }
    if (!failed) return
    if (attempt + 1 < AUTH_STATE_SAVE_ATTEMPTS) {
      console.warn('NovaPay auth state save failed; retrying once.')
      await sleep(AUTH_STATE_SAVE_RETRY_MS)
    }
  }
  throw new NovaPayAuthError(
    500,
    'NOVAPAY_CREDENTIAL_ROTATION_FAILED',
    'NovaPay credentials could not be saved.',
  )
}

export async function getValidNovaPayJwt({
  admin,
  authenticate,
}: {
  admin: NovaPayAdmin
  authenticate: (state: { refreshToken: string; publicCertificate: string }) => Promise<unknown>
}) {
  const owner = crypto.randomUUID()
  let locked = false
  try {
    await acquireRotationLock(admin, owner)
    locked = true
    const { data, error } = await admin.rpc('get_novapay_auth_state')
    if (error || !data || typeof data !== 'object')
      throw new NovaPayAuthError(
        500,
        'NOVAPAY_SECRET_READ_FAILED',
        'Failed to read NovaPay authorization state.',
      )

    if (data.novapay_auth_uncertain === true) {
      throw new NovaPayAuthError(
        409,
        'NOVAPAY_AUTH_RECOVERY_REQUIRED',
        'NovaPay authorization is blocked after an uncertain rotation. Install a fresh credential pair and manually reset the recovery flag.',
      )
    }

    const jwt = text(data.jwt)
    const tokenExpiry = jwtExpiryMs(jwt)
    const storedExpiryText = text(data.jwt_expires_at)
    const storedExpirySeconds = storedExpiryText ? Number(storedExpiryText) : NaN
    const storedExpiry =
      Number.isFinite(storedExpirySeconds) && storedExpirySeconds > 0
        ? storedExpirySeconds * 1000
        : null
    const expiresAt =
      tokenExpiry && storedExpiry ? Math.min(tokenExpiry, storedExpiry) : tokenExpiry

    if (jwt && expiresAt && expiresAt - Date.now() > JWT_SAFETY_MARGIN_MS) return jwt

    const authState = {
      refreshToken: text(data.refresh_token),
      publicCertificate: text(data.public_certificate),
    }
    // Arm durably before sending a single-use credential. Only an atomic save or manual recovery clears it.
    try {
      const { error: beginError } = await admin.rpc('begin_novapay_auth_rotation', {
        lock_owner: owner,
      })
      if (beginError) throw beginError
    } catch {
      throw new NovaPayAuthError(
        503,
        'NOVAPAY_AUTH_GUARD_FAILED',
        'Could not confirm the persistent authorization guard. NovaPay was not contacted; check recovery state before trying again.',
      )
    }
    const result = (await authenticateOnce(authenticate, authState)) as Record<
      string,
      unknown
    > | null
    const nextJwt = text(result?.jwt)
    const refreshToken = text(result?.refresh_token)
    const publicCertificate = text(result?.public_certificate)
    const jwtExpiresAt = jwtExpiryMs(nextJwt)
    if (
      !nextJwt ||
      !refreshToken ||
      !publicCertificate ||
      !jwtExpiresAt ||
      jwtExpiresAt <= Date.now()
    ) {
      throw new NovaPayAuthError(
        502,
        'NOVAPAY_AUTH_INVALID_RESPONSE',
        'NovaPay authentication response is incomplete or has no valid expiry.',
      )
    }

    const responseFingerprints = await credentialFingerprints({
      refreshToken,
      publicCertificate,
    })

    await saveRotatedAuthState(admin, {
      lock_owner: owner,
      new_refresh_token: refreshToken,
      new_public_certificate: publicCertificate,
      new_jwt: nextJwt,
      new_jwt_expires_at: String(Math.floor(jwtExpiresAt / 1000)),
    })

    try {
      const { data: storedState, error: storedStateError } =
        await admin.rpc('get_novapay_auth_state')
      if (storedStateError || !storedState || typeof storedState !== 'object') {
        console.warn('NovaPay auth fingerprint stored read failed.')
      } else {
        const storedFingerprints = await credentialFingerprints({
          refreshToken: text(storedState.refresh_token),
          publicCertificate: text(storedState.public_certificate),
        })
        if (
          storedFingerprints.refresh !== responseFingerprints.refresh ||
          storedFingerprints.certificate !== responseFingerprints.certificate
        ) {
          console.error('NovaPay stored credentials do not match the authentication response.')
        }
      }
    } catch {
      console.warn('NovaPay auth fingerprint stored read failed.')
    }

    return nextJwt
  } finally {
    if (locked) {
      try {
        const { error } = await admin.rpc('release_novapay_rotation_lock', { lock_owner: owner })
        if (error) console.error('NovaPay rotation lock release failed.')
      } catch {
        console.error('NovaPay rotation lock release failed.')
      }
    }
  }
}
