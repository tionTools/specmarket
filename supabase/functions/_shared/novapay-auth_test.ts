import { getValidNovaPayJwt, NovaPayTransportError } from './novapay-auth.ts'

const jwt = (exp: number) => `x.${btoa(JSON.stringify({ exp })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}.x`

Deno.test('reuses a valid shared NovaPay JWT without authenticating', async () => {
  let authenticated = 0
  const validJwt = jwt(Math.floor(Date.now() / 1000) + 300)
  const admin = { rpc: async (name: string) => {
    if (name === 'acquire_novapay_rotation_lock') return { data: true }
    if (name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: { jwt: validJwt, jwt_expires_at: String(Math.floor(Date.now() / 1000) + 300) } }
    throw new Error(name)
  } }
  const result = await getValidNovaPayJwt({ admin, authenticate: async () => { authenticated += 1; return {} } })
  if (result !== validJwt || authenticated !== 0) throw new Error('valid session was not reused')
})

Deno.test('uses JWT exp when stored expiry is empty', async () => {
  let authenticated = 0
  const validJwt = jwt(Math.floor(Date.now() / 1000) + 300)
  const admin = { rpc: async (name: string) => {
    if (name === 'acquire_novapay_rotation_lock' || name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: { jwt: validJwt, jwt_expires_at: '' } }
    throw new Error(name)
  } }
  const result = await getValidNovaPayJwt({ admin, authenticate: async () => { authenticated += 1; return {} } })
  if (result !== validJwt || authenticated !== 0) throw new Error('JWT exp fallback was not reused')
})

Deno.test('authenticates once then saves shared state', async () => {
  let authenticated = 0
  let saved = 0
  let state: Record<string, string> = { refresh_token: 'old', public_certificate: 'old' }
  const nextJwt = jwt(Math.floor(Date.now() / 1000) + 300)
  const admin = { rpc: async (name: string, args?: Record<string, string>) => {
    if (name === 'acquire_novapay_rotation_lock' || name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: state }
    if (name === 'save_novapay_auth_state') {
      saved += 1
      state = { ...state, jwt: args!.new_jwt, jwt_expires_at: args!.new_jwt_expires_at }
      return { data: null }
    }
    throw new Error(name)
  } }
  await getValidNovaPayJwt({ admin, authenticate: async () => { authenticated += 1; return { jwt: nextJwt, refresh_token: 'next', public_certificate: 'next' } } })
  await getValidNovaPayJwt({ admin, authenticate: async () => { authenticated += 1; return {} } })
  if (authenticated !== 1 || saved !== 1) throw new Error('auth state was not atomically saved once')
})

Deno.test('does not continue when saving credentials fails twice', async () => {
  let saved = 0
  const nextJwt = jwt(Math.floor(Date.now() / 1000) + 300)
  const admin = { rpc: async (name: string) => {
    if (name === 'acquire_novapay_rotation_lock' || name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: { refresh_token: 'old', public_certificate: 'old' } }
    if (name === 'save_novapay_auth_state') {
      saved += 1
      return { error: { message: 'failed' } }
    }
    throw new Error(name)
  } }
  await getValidNovaPayJwt({ admin, authenticate: async () => ({ jwt: nextJwt, refresh_token: 'next', public_certificate: 'next' }) })
    .then(() => { throw new Error('save failure was ignored') })
    .catch((error) => { if (error.code !== 'NOVAPAY_CREDENTIAL_ROTATION_FAILED') throw error })
  if (saved !== 2) throw new Error('credential save was not retried once')
})

Deno.test('retries a transient credential save failure without re-authenticating', async () => {
  let authenticated = 0
  let saved = 0
  let state: Record<string, string> = { refresh_token: 'old', public_certificate: 'old' }
  const nextJwt = jwt(Math.floor(Date.now() / 1000) + 300)
  const admin = { rpc: async (name: string, args?: Record<string, string>) => {
    if (name === 'acquire_novapay_rotation_lock' || name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: state }
    if (name === 'save_novapay_auth_state') {
      saved += 1
      if (saved === 1) return { error: { message: 'temporary' } }
      state = {
        ...state,
        refresh_token: args!.new_refresh_token,
        public_certificate: args!.new_public_certificate,
        jwt: args!.new_jwt,
        jwt_expires_at: args!.new_jwt_expires_at,
      }
      return { data: null }
    }
    throw new Error(name)
  } }
  const result = await getValidNovaPayJwt({
    admin,
    authenticate: async () => {
      authenticated += 1
      return { jwt: nextJwt, refresh_token: 'next', public_certificate: 'next' }
    },
  })
  if (result !== nextJwt || authenticated !== 1 || saved !== 2 || state.refresh_token !== 'next') {
    throw new Error('transient credential save failure was not recovered safely')
  }
})

Deno.test('retries one transport failure during JWT rotation', async () => {
  let authenticated = 0
  let saved = 0
  const nextJwt = jwt(Math.floor(Date.now() / 1000) + 300)
  const admin = { rpc: async (name: string) => {
    if (name === 'acquire_novapay_rotation_lock' || name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: { refresh_token: 'old', public_certificate: 'old' } }
    if (name === 'save_novapay_auth_state') { saved += 1; return { data: null } }
    throw new Error(name)
  } }
  const result = await getValidNovaPayJwt({
    admin,
    authenticate: async () => {
      authenticated += 1
      if (authenticated === 1) throw new NovaPayTransportError('response lost')
      return { jwt: nextJwt, refresh_token: 'next', public_certificate: 'next' }
    },
  })
  if (result !== nextJwt || authenticated !== 2 || saved !== 1) throw new Error('transport retry did not recover rotation')
})

Deno.test('stops after two transport failures during JWT rotation', async () => {
  let authenticated = 0
  const admin = { rpc: async (name: string) => {
    if (name === 'acquire_novapay_rotation_lock' || name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: { refresh_token: 'old', public_certificate: 'old' } }
    throw new Error(name)
  } }
  await getValidNovaPayJwt({
    admin,
    authenticate: async () => {
      authenticated += 1
      throw new NovaPayTransportError('response lost')
    },
  })
    .then(() => { throw new Error('second transport failure was ignored') })
    .catch((error) => { if (!(error instanceof NovaPayTransportError)) throw error })
  if (authenticated !== 2) throw new Error('transport retry count was not exactly one')
})

Deno.test('retries one unreadable JWT rotation response', async () => {
  let authenticated = 0
  const nextJwt = jwt(Math.floor(Date.now() / 1000) + 300)
  const admin = { rpc: async (name: string) => {
    if (name === 'acquire_novapay_rotation_lock' || name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: { refresh_token: 'old', public_certificate: 'old' } }
    if (name === 'save_novapay_auth_state') return { data: null }
    throw new Error(name)
  } }
  const result = await getValidNovaPayJwt({
    admin,
    authenticate: async () => {
      authenticated += 1
      if (authenticated === 1) throw Object.assign(new Error('bad xml'), { code: 'NOVAPAY_SOAP_PARSE_ERROR' })
      return { jwt: nextJwt, refresh_token: 'next', public_certificate: 'next' }
    },
  })
  if (result !== nextJwt || authenticated !== 2) throw new Error('unreadable auth response was not retried once')
})

Deno.test('retries one missing JWT rotation result', async () => {
  let authenticated = 0
  const nextJwt = jwt(Math.floor(Date.now() / 1000) + 300)
  const admin = { rpc: async (name: string) => {
    if (name === 'acquire_novapay_rotation_lock' || name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: { refresh_token: 'old', public_certificate: 'old' } }
    if (name === 'save_novapay_auth_state') return { data: null }
    throw new Error(name)
  } }
  const result = await getValidNovaPayJwt({
    admin,
    authenticate: async () => {
      authenticated += 1
      if (authenticated === 1) throw Object.assign(new Error('missing result'), { code: 'NOVAPAY_SOAP_RESULT_MISSING' })
      return { jwt: nextJwt, refresh_token: 'next', public_certificate: 'next' }
    },
  })
  if (result !== nextJwt || authenticated !== 2) throw new Error('missing auth result was not retried once')
})

Deno.test('does not retry logical NovaPay API errors during JWT rotation', async () => {
  let authenticated = 0
  const logicalError = Object.assign(new Error('invalid refresh token'), { code: 'NOVAPAY_API_ERROR' })
  const admin = { rpc: async (name: string) => {
    if (name === 'acquire_novapay_rotation_lock' || name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: { refresh_token: 'old', public_certificate: 'old' } }
    throw new Error(name)
  } }
  await getValidNovaPayJwt({
    admin,
    authenticate: async () => {
      authenticated += 1
      throw logicalError
    },
  })
    .then(() => { throw new Error('logical API error was ignored') })
    .catch((error) => { if (error !== logicalError) throw error })
  if (authenticated !== 1) throw new Error('logical API error was retried')
})

Deno.test('rejects rotated credentials with unknown JWT expiry before saving', async () => {
  let authenticated = 0
  let saved = 0
  const admin = { rpc: async (name: string) => {
    if (name === 'acquire_novapay_rotation_lock' || name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: { refresh_token: 'old', public_certificate: 'old' } }
    if (name === 'save_novapay_auth_state') { saved += 1; return { data: null } }
    throw new Error(name)
  } }
  await getValidNovaPayJwt({
    admin,
    authenticate: async () => {
      authenticated += 1
      return { jwt: 'opaque.jwt.without-exp', refresh_token: 'next', public_certificate: 'next' }
    },
  })
    .then(() => { throw new Error('unknown JWT expiry was accepted') })
    .catch((error) => { if (error.code !== 'NOVAPAY_AUTH_INVALID_RESPONSE') throw error })
  if (authenticated !== 1 || saved !== 0) throw new Error('invalid rotated credentials reached persistence')
})
