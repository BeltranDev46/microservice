import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'

const TEST_CONFIG = {
  microserviceApiKey: 'test_service_api_key_secret_12345',
  jwtSecret: 'test_jwt_hs256_secret_must_be_at_least_32_bytes_long',
  authClientId: 'test-main-app',
  authClientSecret: 'test-client-secret-xyz',
  externalApiBaseUrl: 'https://mock-fx-provider.example/v1',
  externalApiTimeoutMs: 2000,
}

function createMockFetch({ mode = 'ok' } = {}) {
  return async (url) => {
    const parsed = new URL(url)

    if (mode === 'network_error') {
      throw new TypeError('fetch failed')
    }

    if (mode === 'timeout') {
      const err = new Error('The operation was aborted due to timeout')
      err.name = 'TimeoutError'
      throw err
    }

    if (mode === 'upstream_500') {
      return new Response(JSON.stringify({ message: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (mode === 'invalid_json') {
      return new Response('<html>Bad Gateway</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    }

    if (parsed.pathname.endsWith('/currencies')) {
      return new Response(
        JSON.stringify({
          EUR: 'Euro',
          MXN: 'Mexican Peso',
          USD: 'United States Dollar',
          CAD: 'Canadian Dollar',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (parsed.pathname.endsWith('/latest')) {
      const base = parsed.searchParams.get('base') || 'EUR'
      const symbols = (parsed.searchParams.get('symbols') || '').split(',').filter(Boolean)

      const known = new Set(['EUR', 'MXN', 'USD', 'CAD'])
      if (!known.has(base) || symbols.some((s) => !known.has(s))) {
        return new Response(JSON.stringify({ message: 'not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const rateTable = {
        USD: { MXN: 18.6, EUR: 0.89, CAD: 1.38 },
        EUR: { MXN: 20.9, USD: 1.12, CAD: 1.55 },
        MXN: { USD: 0.0538, EUR: 0.0478, CAD: 0.0742 },
        CAD: { MXN: 13.48, USD: 0.72, EUR: 0.64 },
      }

      const baseRates = rateTable[base] || {}
      const rates =
        symbols.length > 0
          ? Object.fromEntries(symbols.map((s) => [s, baseRates[s]]))
          : baseRates

      return new Response(
        JSON.stringify({
          amount: 1,
          base,
          date: '2026-11-05',
          rates,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
  }
}

async function withTestServer(options, fn) {
  const app = createApp({
    configOverrides: TEST_CONFIG,
    fetchImpl: createMockFetch(options),
    silentErrors: true,
  })

  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv))
  })

  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    await fn(baseUrl)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('GET /api/v1/health returns 200 OK with service metadata', async () => {
  await withTestServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/health`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.status, 'ok')
    assert.equal(body.service, 'cuentasclaras-fx-microservice')
    assert.equal('stack' in body, false)
  })
})

test('GET /api/v1/currencies fetches and formats supported currencies from third-party API', async () => {
  await withTestServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/currencies`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.count, 4)
    assert.ok(Array.isArray(body.currencies))
    assert.deepEqual(body.currencies[0], { code: 'CAD', name: 'Canadian Dollar' })
  })
})

test('GET /api/v1/rates validates query params (400) and returns rates on valid request (200)', async () => {
  await withTestServer({}, async (baseUrl) => {
    // Valid request
    const okRes = await fetch(`${baseUrl}/api/v1/rates?base=USD&symbols=MXN,EUR`)
    assert.equal(okRes.status, 200)
    const okBody = await okRes.json()
    assert.equal(okBody.base, 'USD')
    assert.equal(okBody.rates.MXN, 18.6)
    assert.equal(okBody.rates.EUR, 0.89)

    // Invalid base currency code -> 400 Bad Request, no stack trace
    const badRes = await fetch(`${baseUrl}/api/v1/rates?base=INVALID123`)
    assert.equal(badRes.status, 400)
    const badBody = await badRes.json()
    assert.equal(badBody.code, 'VALIDATION_ERROR')
    assert.ok(Array.isArray(badBody.details))
    assert.equal('stack' in badBody, false)
  })
})

test('Protected endpoints reject unauthenticated or invalid-token requests with 401', async () => {
  await withTestServer({}, async (baseUrl) => {
    // Missing Authorization header
    const resNoAuth = await fetch(`${baseUrl}/api/v1/conversions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 50, from: 'USD', to: 'MXN' }),
    })
    assert.equal(resNoAuth.status, 401)
    const noAuthBody = await resNoAuth.json()
    assert.equal(noAuthBody.code, 'UNAUTHORIZED')
    assert.equal('stack' in noAuthBody, false)

    // Invalid Bearer token
    const resBadToken = await fetch(`${baseUrl}/api/v1/conversions`, {
      headers: { Authorization: 'Bearer wrong_token_value' },
    })
    assert.equal(resBadToken.status, 401)
    const badTokenBody = await resBadToken.json()
    assert.equal(badTokenBody.code, 'INVALID_TOKEN')
  })
})

test('POST /api/v1/auth/token issues a JWT that unlocks protected endpoints (201, 200, DELETE)', async () => {
  await withTestServer({}, async (baseUrl) => {
    // Exchange client credentials for JWT
    const tokenRes = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: TEST_CONFIG.authClientId,
        clientSecret: TEST_CONFIG.authClientSecret,
      }),
    })
    assert.equal(tokenRes.status, 200)
    const { accessToken } = await tokenRes.json()
    assert.ok(accessToken)

    // Create conversion with JWT -> 201 Created
    const createRes = await fetch(`${baseUrl}/api/v1/conversions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-User-Id': 'user-123',
      },
      body: JSON.stringify({
        concept: 'Cena en viaje',
        amount: 100,
        from: 'USD',
        to: 'MXN',
        participants: 4,
      }),
    })
    assert.equal(createRes.status, 201)
    assert.match(createRes.headers.get('location') || '', /^\/api\/v1\/conversions\//)
    const created = await createRes.json()
    assert.equal(created.originalAmount, 100)
    assert.equal(created.convertedAmount, 1860)
    assert.equal(created.perPersonAmount, 465)

    // List conversions -> 200 OK
    const listRes = await fetch(`${baseUrl}/api/v1/conversions`, {
      headers: {
        Authorization: `Bearer ${TEST_CONFIG.microserviceApiKey}`,
        'X-User-Id': 'user-123',
      },
    })
    assert.equal(listRes.status, 200)
    const listBody = await listRes.json()
    assert.equal(listBody.count, 1)
    assert.equal(listBody.items[0].id, created.id)

    // Delete conversion -> 200 OK
    const delRes = await fetch(`${baseUrl}/api/v1/conversions/${created.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${TEST_CONFIG.microserviceApiKey}`,
        'X-User-Id': 'user-123',
      },
    })
    assert.equal(delRes.status, 200)
    const delBody = await delRes.json()
    assert.equal(delBody.deleted, true)

    // Deleting again -> 404 Not Found
    const delAgain = await fetch(`${baseUrl}/api/v1/conversions/${created.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${TEST_CONFIG.microserviceApiKey}`,
        'X-User-Id': 'user-123',
      },
    })
    assert.equal(delAgain.status, 404)
  })
})

test('Input validation returns 400 with clear JSON errors and never exposes stack traces', async () => {
  await withTestServer({}, async (baseUrl) => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEST_CONFIG.microserviceApiKey}`,
    }

    // Negative amount & invalid currency
    const invalidBodyRes = await fetch(`${baseUrl}/api/v1/conversions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: -25, from: 'US', to: 'MXN' }),
    })
    assert.equal(invalidBodyRes.status, 400)
    const invalidJson = await invalidBodyRes.json()
    assert.equal(invalidJson.code, 'VALIDATION_ERROR')
    assert.equal(invalidJson.details.length, 2)
    assert.equal('stack' in invalidJson, false)

    // Malformed raw JSON syntax
    const brokenJsonRes = await fetch(`${baseUrl}/api/v1/conversions`, {
      method: 'POST',
      headers,
      body: '{"amount": 50, "from": ',
    })
    assert.equal(brokenJsonRes.status, 400)
    const brokenBody = await brokenJsonRes.json()
    assert.equal(brokenBody.code, 'INVALID_JSON')
    assert.equal('stack' in brokenBody, false)

    // Invalid UUID on DELETE
    const badUuidRes = await fetch(`${baseUrl}/api/v1/conversions/not-a-uuid`, {
      method: 'DELETE',
      headers,
    })
    assert.equal(badUuidRes.status, 400)
    const badUuidBody = await badUuidRes.json()
    assert.equal(badUuidBody.code, 'VALIDATION_ERROR')
    assert.equal('stack' in badUuidBody, false)
  })
})

test('Third-party API failures are handled gracefully (502 / 504) without stack traces', async () => {
  // Network error -> 502
  await withTestServer({ mode: 'network_error' }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/rates?base=USD&symbols=MXN`)
    assert.equal(res.status, 502)
    const body = await res.json()
    assert.equal(body.code, 'UPSTREAM_UNAVAILABLE')
    assert.equal('stack' in body, false)
  })

  // Timeout -> 504
  await withTestServer({ mode: 'timeout' }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/rates?base=USD&symbols=MXN`)
    assert.equal(res.status, 504)
    const body = await res.json()
    assert.equal(body.code, 'UPSTREAM_TIMEOUT')
    assert.equal('stack' in body, false)
  })

  // Upstream 500 -> 502
  await withTestServer({ mode: 'upstream_500' }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/currencies`)
    assert.equal(res.status, 502)
    const body = await res.json()
    assert.equal(body.code, 'UPSTREAM_ERROR')
    assert.equal('stack' in body, false)
  })

  // Invalid upstream JSON -> 502
  await withTestServer({ mode: 'invalid_json' }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/currencies`)
    assert.equal(res.status, 502)
    const body = await res.json()
    assert.equal(body.code, 'UPSTREAM_INVALID_RESPONSE')
    assert.equal('stack' in body, false)
  })
})

