export const NOVAPAY_AUTH_SOAP_TIMEOUT_MS = 60_000
export const NOVAPAY_DATA_SOAP_TIMEOUT_MS = 30_000

export function novaPaySoapTimeoutMs(method: string): number {
  return method === 'UserAuthenticationJWT'
    ? NOVAPAY_AUTH_SOAP_TIMEOUT_MS
    : NOVAPAY_DATA_SOAP_TIMEOUT_MS
}
