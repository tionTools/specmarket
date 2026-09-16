import { getValidNovaPayJwt } from './novapay-auth.ts'

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

Deno.test('blocks a JWT with valid exp when stored expiry is empty', async () => {
  let authenticated = 0
  const validJwt = jwt(Math.floor(Date.now() / 1000) + 300)
  const admin = { rpc: async (name: string) => {
    if (name === 'acquire_novapay_rotation_lock' || name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: { jwt: validJwt, jwt_expires_at: '' } }
    throw new Error(name)
  } }
  await getValidNovaPayJwt({ admin, authenticate: async () => { authenticated += 1; return {} } })
    .then(() => { throw new Error('unknown stored expiry was accepted') })
    .catch((error) => { if (error.code !== 'NOVAPAY_JWT_EXPIRY_UNKNOWN') throw error })
  if (authenticated !== 0) throw new Error('unknown stored expiry triggered authentication')
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

Deno.test('does not continue when saving credentials fails', async () => {
  const nextJwt = jwt(Math.floor(Date.now() / 1000) + 300)
  const admin = { rpc: async (name: string) => {
    if (name === 'acquire_novapay_rotation_lock' || name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: { refresh_token: 'old', public_certificate: 'old' } }
    if (name === 'save_novapay_auth_state') return { error: { message: 'failed' } }
    throw new Error(name)
  } }
  await getValidNovaPayJwt({ admin, authenticate: async () => ({ jwt: nextJwt, refresh_token: 'next', public_certificate: 'next' }) })
    .then(() => { throw new Error('save failure was ignored') })
    .catch((error) => { if (error.code !== 'NOVAPAY_CREDENTIAL_ROTATION_FAILED') throw error })
})

Deno.test('saves rotated credentials with unknown expiry and blocks the next auth attempt', async () => {
  let authenticated = 0
  let saved = 0
  let state: Record<string, string> = { refresh_token: 'old', public_certificate: 'old' }
  const admin = { rpc: async (name: string, args?: Record<string, string>) => {
    if (name === 'acquire_novapay_rotation_lock' || name === 'release_novapay_rotation_lock') return { data: true }
    if (name === 'get_novapay_auth_state') return { data: state }
    if (name === 'save_novapay_auth_state') {
      saved += 1
      state = { ...state, refresh_token: args!.new_refresh_token, public_certificate: args!.new_public_certificate, jwt: args!.new_jwt, jwt_expires_at: args!.new_jwt_expires_at }
      return { data: null }
    }
    throw new Error(name)
  } }
  const freshJwt = 'opaque.jwt.without-exp'
  const first = await getValidNovaPayJwt({ admin, authenticate: async () => { authenticated += 1; return { jwt: freshJwt, refresh_token: 'next', public_certificate: 'next' } } })
  if (first !== freshJwt || saved !== 1 || state.refresh_token !== 'next' || state.public_certificate !== 'next') throw new Error('rotated credentials were not saved')
  await getValidNovaPayJwt({ admin, authenticate: async () => { authenticated += 1; return {} } })
    .then(() => { throw new Error('unknown expiry was reused or re-authenticated') })
    .catch((error) => { if (error.code !== 'NOVAPAY_JWT_EXPIRY_UNKNOWN') throw error })
  if (authenticated !== 1) throw new Error('unknown expiry triggered another authentication')
})
