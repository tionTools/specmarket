import { getValidNovaPayJwt, NovaPayTransportError } from './novapay-auth.ts'
import { XMLParser } from 'npm:fast-xml-parser@5.11.1'

Deno.test('NovaPay auth XML preserves returned credentials through the next SOAP request', () => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    htmlEntities: true,
  })
  const result = parser.parse(
    '<UserAuthenticationJWTResult><refresh_token>a&#43;b&amp;c</refresh_token><public_certificate>-----BEGIN CERTIFICATE-----&#13;&#10;ABC&#xD;&#xA;-----END CERTIFICATE-----</public_certificate></UserAuthenticationJWTResult>',
  ).UserAuthenticationJWTResult
  const certificate = '-----BEGIN CERTIFICATE-----\r\nABC\r\n-----END CERTIFICATE-----'
  if (result.refresh_token !== 'a+b&c' || result.public_certificate !== certificate) {
    throw new Error('returned credentials were not XML-decoded')
  }
  const escapeXml = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;')
  const next = parser.parse(
    `<request><refresh_token>${escapeXml(result.refresh_token)}</refresh_token><public_certificate>${escapeXml(result.public_certificate)}</public_certificate></request>`,
  ).request
  if (
    next.refresh_token !== result.refresh_token ||
    next.public_certificate !== certificate.replaceAll('\r\n', '\n')
  ) {
    throw new Error('next SOAP request corrupted returned credentials')
  }
})

const jwt = (exp: number) =>
  `x.${btoa(JSON.stringify({ exp })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}.x`

Deno.test('reuses a valid shared NovaPay JWT without authenticating', async () => {
  let authenticated = 0
  const validJwt = jwt(Math.floor(Date.now() / 1000) + 900)
  const admin = {
    rpc: async (name: string) => {
      if (name === 'acquire_novapay_rotation_lock_owned') return { data: true }
      if (name === 'release_novapay_rotation_lock') return { data: true }
      if (name === 'get_novapay_auth_state')
        return {
          data: { jwt: validJwt, jwt_expires_at: String(Math.floor(Date.now() / 1000) + 900) },
        }
      throw new Error(name)
    },
  }
  const result = await getValidNovaPayJwt({
    admin,
    authenticate: async () => {
      authenticated += 1
      return {}
    },
  })
  if (result !== validJwt || authenticated !== 0) throw new Error('valid session was not reused')
})

Deno.test('uses JWT exp when stored expiry is empty', async () => {
  let authenticated = 0
  const validJwt = jwt(Math.floor(Date.now() / 1000) + 900)
  const admin = {
    rpc: async (name: string) => {
      if (
        name === 'acquire_novapay_rotation_lock_owned' ||
        name === 'release_novapay_rotation_lock'
      )
        return { data: true }
      if (name === 'get_novapay_auth_state') return { data: { jwt: validJwt, jwt_expires_at: '' } }
      throw new Error(name)
    },
  }
  const result = await getValidNovaPayJwt({
    admin,
    authenticate: async () => {
      authenticated += 1
      return {}
    },
  })
  if (result !== validJwt || authenticated !== 0) throw new Error('JWT exp fallback was not reused')
})

Deno.test('authenticates once then saves shared state', async () => {
  let authenticated = 0
  let saved = 0
  let state: Record<string, string> = { refresh_token: 'old', public_certificate: 'old' }
  const nextJwt = jwt(Math.floor(Date.now() / 1000) + 900)
  const admin = {
    rpc: async (name: string, args?: Record<string, string>) => {
      if (
        name === 'acquire_novapay_rotation_lock_owned' ||
        name === 'release_novapay_rotation_lock'
      )
        return { data: true }
      if (name === 'get_novapay_auth_state') return { data: state }
      if (name === 'save_novapay_auth_state_owned') {
        saved += 1
        state = { ...state, jwt: args!.new_jwt, jwt_expires_at: args!.new_jwt_expires_at }
        return { data: null }
      }
      throw new Error(name)
    },
  }
  await getValidNovaPayJwt({
    admin,
    authenticate: async () => {
      authenticated += 1
      return { jwt: nextJwt, refresh_token: 'next', public_certificate: 'next' }
    },
  })
  await getValidNovaPayJwt({
    admin,
    authenticate: async () => {
      authenticated += 1
      return {}
    },
  })
  if (authenticated !== 1 || saved !== 1)
    throw new Error('auth state was not atomically saved once')
})

Deno.test('does not continue when saving credentials fails twice', async () => {
  let saved = 0
  const nextJwt = jwt(Math.floor(Date.now() / 1000) + 900)
  const admin = {
    rpc: async (name: string) => {
      if (
        name === 'acquire_novapay_rotation_lock_owned' ||
        name === 'release_novapay_rotation_lock'
      )
        return { data: true }
      if (name === 'get_novapay_auth_state')
        return { data: { refresh_token: 'old', public_certificate: 'old' } }
      if (name === 'save_novapay_auth_state_owned') {
        saved += 1
        return { error: { message: 'failed' } }
      }
      throw new Error(name)
    },
  }
  await getValidNovaPayJwt({
    admin,
    authenticate: async () => ({ jwt: nextJwt, refresh_token: 'next', public_certificate: 'next' }),
  })
    .then(() => {
      throw new Error('save failure was ignored')
    })
    .catch((error) => {
      if (error.code !== 'NOVAPAY_CREDENTIAL_ROTATION_FAILED') throw error
    })
  if (saved !== 2) throw new Error('credential save was not retried once')
})

Deno.test('retries a transient credential save failure without re-authenticating', async () => {
  let authenticated = 0
  let saved = 0
  let state: Record<string, string> = { refresh_token: 'old', public_certificate: 'old' }
  const nextJwt = jwt(Math.floor(Date.now() / 1000) + 900)
  const admin = {
    rpc: async (name: string, args?: Record<string, string>) => {
      if (
        name === 'acquire_novapay_rotation_lock_owned' ||
        name === 'release_novapay_rotation_lock'
      )
        return { data: true }
      if (name === 'get_novapay_auth_state') return { data: state }
      if (name === 'save_novapay_auth_state_owned') {
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
    },
  }
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

Deno.test('does not retry logical NovaPay API errors during JWT rotation', async () => {
  let authenticated = 0
  const logicalError = Object.assign(new Error('invalid refresh token'), {
    code: 'NOVAPAY_API_ERROR',
  })
  const admin = {
    rpc: async (name: string) => {
      if (
        name === 'acquire_novapay_rotation_lock_owned' ||
        name === 'release_novapay_rotation_lock'
      )
        return { data: true }
      if (name === 'get_novapay_auth_state')
        return { data: { refresh_token: 'old', public_certificate: 'old' } }
      throw new Error(name)
    },
  }
  await getValidNovaPayJwt({
    admin,
    authenticate: async () => {
      authenticated += 1
      throw logicalError
    },
  })
    .then(() => {
      throw new Error('logical API error was ignored')
    })
    .catch((error) => {
      if (error !== logicalError) throw error
    })
  if (authenticated !== 1) throw new Error('logical API error was retried')
})

Deno.test('rejects rotated credentials with unknown JWT expiry before saving', async () => {
  let authenticated = 0
  let saved = 0
  const admin = {
    rpc: async (name: string) => {
      if (
        name === 'acquire_novapay_rotation_lock_owned' ||
        name === 'release_novapay_rotation_lock'
      )
        return { data: true }
      if (name === 'get_novapay_auth_state')
        return { data: { refresh_token: 'old', public_certificate: 'old' } }
      if (name === 'save_novapay_auth_state_owned') {
        saved += 1
        return { data: null }
      }
      throw new Error(name)
    },
  }
  await getValidNovaPayJwt({
    admin,
    authenticate: async () => {
      authenticated += 1
      return { jwt: 'opaque.jwt.without-exp', refresh_token: 'next', public_certificate: 'next' }
    },
  })
    .then(() => {
      throw new Error('unknown JWT expiry was accepted')
    })
    .catch((error) => {
      if (error.code !== 'NOVAPAY_AUTH_INVALID_RESPONSE') throw error
    })
  if (authenticated !== 1 || saved !== 0)
    throw new Error('invalid rotated credentials reached persistence')
})

for (const failure of [
  new NovaPayTransportError('lost response after token consumption'),
  Object.assign(new Error('unreadable response'), { code: 'NOVAPAY_SOAP_PARSE_ERROR' }),
  Object.assign(new Error('missing result'), { code: 'NOVAPAY_SOAP_RESULT_MISSING' }),
]) {
  Deno.test(`does not retry ambiguous auth: ${failure.message}`, async () => {
    let calls = 0
    let released = false
    const admin = {
      rpc: async (name: string) => {
        if (name === 'acquire_novapay_rotation_lock_owned') return { data: true }
        if (name === 'get_novapay_auth_state')
          return { data: { refresh_token: 'old', public_certificate: 'old' } }
        if (name === 'release_novapay_rotation_lock') {
          released = true
          throw new Error('release transport failure')
        }
        throw new Error('unexpected save')
      },
    }
    await getValidNovaPayJwt({
      admin,
      authenticate: async () => {
        calls++
        throw failure
      },
    })
      .then(() => {
        throw new Error('ambiguous auth accepted')
      })
      .catch((error) => {
        if (error.code !== 'NOVAPAY_AUTH_UNCERTAIN') throw error
      })
    if (calls !== 1 || !released) throw new Error('retried auth or failed to release')
  })
}

Deno.test('lost lock prevents save retry and carries acquisition owner to save', async () => {
  let owner = ''
  let saves = 0
  const admin = {
    rpc: async (name: string, args?: Record<string, string>) => {
      if (name === 'acquire_novapay_rotation_lock_owned') {
        owner = args!.lock_owner
        return { data: true }
      }
      if (name === 'release_novapay_rotation_lock') return { data: true }
      if (name === 'get_novapay_auth_state')
        return { data: { refresh_token: 'old', public_certificate: 'old' } }
      if (name === 'save_novapay_auth_state_owned') {
        if (!owner || args!.lock_owner !== owner) throw new Error('wrong owner')
        saves++
        return { error: { code: 'NP001' } }
      }
      throw new Error(name)
    },
  }
  await getValidNovaPayJwt({
    admin,
    authenticate: async () => ({
      jwt: jwt(Math.floor(Date.now() / 1000) + 900),
      refresh_token: 'new',
      public_certificate: 'new',
    }),
  })
    .then(() => {
      throw new Error('stale owner accepted')
    })
    .catch((error) => {
      if (error.code !== 'NOVAPAY_AUTH_LOCK_LOST') throw error
    })
  if (saves !== 1) throw new Error('stale save retried')
})

Deno.test('waits past old lock deadline, rereads state and has a bounded busy exit', async () => {
  const originalTimeout = globalThis.setTimeout
  let waits = 0
  globalThis.setTimeout = ((callback: () => void) => {
    waits++
    callback()
    return 0
  }) as unknown as typeof setTimeout
  try {
    let attempts = 0
    const validJwt = jwt(Math.floor(Date.now() / 1000) + 900)
    const admin = {
      rpc: async (name: string) => {
        if (name === 'acquire_novapay_rotation_lock_owned') return { data: ++attempts === 81 }
        if (name === 'release_novapay_rotation_lock') return { data: true }
        if (name === 'get_novapay_auth_state') return { data: { jwt: validJwt } }
        throw new Error(name)
      },
    }
    const result = await getValidNovaPayJwt({
      admin,
      authenticate: async () => {
        throw new Error('unnecessary rotation')
      },
    })
    if (result !== validJwt || waits !== 80) throw new Error('wait/reread failed')
    waits = 0
    await getValidNovaPayJwt({
      admin: { rpc: async () => ({ data: false }) },
      authenticate: async () => ({}),
    })
      .then(() => {
        throw new Error('busy accepted')
      })
      .catch((error) => {
        if (error.code !== 'NOVAPAY_AUTH_BUSY') throw error
      })
    if (waits !== 120) throw new Error('wait was not bounded')
  } finally {
    globalThis.setTimeout = originalTimeout
  }
})

for (const downstreamFailure of ['GetPaymentsList', 'cache write']) {
  Deno.test(`saved rotation survives later ${downstreamFailure} failure`, async () => {
    let state: Record<string, string> = {
      refresh_token: 'old',
      public_certificate: 'old',
      jwt: jwt(Math.floor(Date.now() / 1000) + 240),
    }
    let calls = 0
    const nextJwt = jwt(Math.floor(Date.now() / 1000) + 900)
    const admin = {
      rpc: async (name: string, args?: Record<string, string>) => {
        if (
          name === 'acquire_novapay_rotation_lock_owned' ||
          name === 'release_novapay_rotation_lock'
        )
          return { data: true }
        if (name === 'get_novapay_auth_state') return { data: state }
        if (name === 'save_novapay_auth_state_owned') {
          state = {
            refresh_token: args!.new_refresh_token,
            public_certificate: args!.new_public_certificate,
            jwt: args!.new_jwt,
            jwt_expires_at: args!.new_jwt_expires_at,
          }
          return { data: null }
        }
        throw new Error(name)
      },
    }
    const authenticate = async () => {
      calls++
      return { jwt: nextJwt, refresh_token: 'new', public_certificate: 'new' }
    }
    const failure = new Error(downstreamFailure)
    try {
      await getValidNovaPayJwt({ admin, authenticate })
      throw failure
    } catch (error) {
      if (error !== failure) throw error
    }
    const result = await getValidNovaPayJwt({ admin, authenticate })
    if (calls !== 1 || result !== nextJwt || state.refresh_token !== 'new')
      throw new Error('saved auth was not reused or 5-minute margin not enforced')
  })
}
