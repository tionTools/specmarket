const LOCK_LEASE_SECONDS = 90
const LOCK_WAIT_ATTEMPTS = 20
const LOCK_WAIT_MS = 250
const JWT_SAFETY_MARGIN_MS = 60_000

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class NovaPayAuthError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'NovaPayAuthError'
  }
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

async function acquireRotationLock(admin: any, owner: string) {
  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    const { data, error } = await admin.rpc('acquire_novapay_rotation_lock', {
      lock_owner: owner,
      lease_seconds: LOCK_LEASE_SECONDS,
    })
    if (error) throw new NovaPayAuthError(500, 'NOVAPAY_LOCK_FAILED', 'Failed to acquire NovaPay authorization lock.')
    if (data === true) return
    if (attempt + 1 < LOCK_WAIT_ATTEMPTS) await sleep(LOCK_WAIT_MS)
  }
  throw new NovaPayAuthError(409, 'NOVAPAY_AUTH_BUSY', 'NovaPay authorization is busy. Retry shortly.')
}

export async function getValidNovaPayJwt({ admin, authenticate }: {
  admin: any
  authenticate: (state: { refreshToken: string; publicCertificate: string }) => Promise<unknown>
}) {
  const owner = crypto.randomUUID()
  let locked = false
  try {
    await acquireRotationLock(admin, owner)
    locked = true
    const { data, error } = await admin.rpc('get_novapay_auth_state')
    if (error || !data) throw new NovaPayAuthError(500, 'NOVAPAY_SECRET_READ_FAILED', 'Failed to read NovaPay authorization state.')

    const jwt = text(data.jwt)
    const tokenExpiry = jwtExpiryMs(jwt)
    const storedExpiryText = text(data.jwt_expires_at)
    const storedExpirySeconds = storedExpiryText ? Number(storedExpiryText) : NaN
    const storedExpiry = Number.isFinite(storedExpirySeconds) && storedExpirySeconds > 0
      ? storedExpirySeconds * 1000
      : null
    const expiresAt = tokenExpiry && storedExpiry ? Math.min(tokenExpiry, storedExpiry) : tokenExpiry

    if (jwt && expiresAt && expiresAt - Date.now() > JWT_SAFETY_MARGIN_MS) return jwt

    const result: any = await authenticate({
      refreshToken: text(data.refresh_token),
      publicCertificate: text(data.public_certificate),
    })
    const nextJwt = text(result?.jwt)
    const refreshToken = text(result?.refresh_token)
    const publicCertificate = text(result?.public_certificate)
    const jwtExpiresAt = jwtExpiryMs(nextJwt)
    if (!nextJwt || !refreshToken || !publicCertificate || !jwtExpiresAt || jwtExpiresAt <= Date.now()) {
      throw new NovaPayAuthError(502, 'NOVAPAY_AUTH_INVALID_RESPONSE', 'NovaPay authentication response is incomplete or has no valid expiry.')
    }

    const { error: saveError } = await admin.rpc('save_novapay_auth_state', {
      new_refresh_token: refreshToken,
      new_public_certificate: publicCertificate,
      new_jwt: nextJwt,
      new_jwt_expires_at: String(Math.floor(jwtExpiresAt / 1000)),
    })
    if (saveError) throw new NovaPayAuthError(500, 'NOVAPAY_CREDENTIAL_ROTATION_FAILED', 'NovaPay credentials could not be saved.')
    return nextJwt
  } finally {
    if (locked) {
      const { error } = await admin.rpc('release_novapay_rotation_lock', { lock_owner: owner })
      if (error) console.error('NovaPay rotation lock release failed.')
    }
  }
}
