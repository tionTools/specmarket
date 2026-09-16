export type FirebaseSecrets = {
  projectId: string
  clientEmail: string
  privateKey: string
}

export type PushData = Record<string, string>

const encoder = new TextEncoder()
const base64Url = (value: Uint8Array | string) => {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function pemBytes(value: string) {
  const compact = value
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '')
  const binary = atob(compact)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export async function firebaseAccessToken(secrets: FirebaseSecrets) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify({
    iss: secrets.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const unsigned = `${header}.${payload}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(secrets.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned)))
  const assertion = `${unsigned}.${base64Url(signature)}`
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const body = await response.json().catch(() => ({})) as { access_token?: string; error_description?: string }
  if (!response.ok || !body.access_token) throw new Error(body.error_description || `Firebase OAuth failed: ${response.status}`)
  return body.access_token
}

export function newOrderPushPayload(order: {
  id: string
  platform?: string | null
  order_label?: string | null
  order_number?: number | null
  customer?: string | null
}, total: number): PushData {
  return {
    type: 'new_order',
    order_id: order.id,
    platform: order.platform?.trim() || '—',
    total: Number.isFinite(total) ? `${total.toFixed(2)} грн` : '—',
    customer: order.customer?.trim() || '—',
    order_number: order.order_label?.trim() || order.order_number?.toString() || '—',
  }
}

export async function sendFirebaseDataMessage(args: {
  accessToken: string
  projectId: string
  token: string
  data: PushData
}) {
  return fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(args.projectId)}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: args.token,
        data: args.data,
        android: { priority: 'high', ttl: '86400s' },
      },
    }),
  })
}

export async function fcmTokenIsUnregistered(response: Response) {
  if (response.status === 404) return true
  if (response.ok) return false
  const text = await response.clone().text().catch(() => '')
  return /UNREGISTERED|registration-token-not-registered/i.test(text)
}
