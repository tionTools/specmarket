import {
  NOVAPAY_AUTH_SOAP_TIMEOUT_MS,
  NOVAPAY_DATA_SOAP_TIMEOUT_MS,
  novaPaySoapTimeoutMs,
} from './novapay-soap-timeout.ts'

Deno.test('NovaPay authentication has its own longer timeout', () => {
  if (novaPaySoapTimeoutMs('UserAuthenticationJWT') !== 60_000) {
    throw new Error('Authentication SOAP timeout must be 60 seconds')
  }
  if (NOVAPAY_AUTH_SOAP_TIMEOUT_MS >= 120_000) {
    throw new Error('Authentication SOAP timeout must leave room within the 120-second lock')
  }
})

Deno.test('NovaPay data requests keep their original timeout', () => {
  for (const method of ['GetClientsList', 'GetAccountsList', 'GetAccountRest', 'GetPaymentsList']) {
    if (novaPaySoapTimeoutMs(method) !== NOVAPAY_DATA_SOAP_TIMEOUT_MS) {
      throw new Error(`Unexpected SOAP timeout for ${method}`)
    }
  }
  if (NOVAPAY_DATA_SOAP_TIMEOUT_MS !== 30_000) {
    throw new Error('Data SOAP timeout unexpectedly changed')
  }
})
