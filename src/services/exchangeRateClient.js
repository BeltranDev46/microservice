import { AppError } from '../middleware/errorHandler.js'

const CURRENCY_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

export function createExchangeRateClient(config, { fetchImpl = globalThis.fetch } = {}) {
  let currenciesCache = null
  let currenciesCacheExpiresAt = 0

  async function requestJson(pathname, searchParams = null) {
    const url = new URL(`${config.externalApiBaseUrl}${pathname}`)
    if (searchParams) {
      for (const [key, value] of Object.entries(searchParams)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value))
        }
      }
    }

    let response
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(config.externalApiTimeoutMs),
      })
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new AppError(
          504,
          'UPSTREAM_TIMEOUT',
          'El proveedor externo de tipos de cambio tardó demasiado en responder. Intenta de nuevo en unos segundos.'
        )
      }
      throw new AppError(
        502,
        'UPSTREAM_UNAVAILABLE',
        'No fue posible conectar con el proveedor externo de tipos de cambio.'
      )
    }

    if (!response.ok) {
      if (response.status === 404 || response.status === 422 || response.status === 400) {
        throw new AppError(
          400,
          'UNSUPPORTED_CURRENCY',
          'Una o más monedas solicitadas no son soportadas por el proveedor de tipos de cambio.'
        )
      }
      throw new AppError(
        502,
        'UPSTREAM_ERROR',
        `El proveedor externo de divisas respondió con estado inesperado (${response.status}).`
      )
    }

    let data
    try {
      data = await response.json()
    } catch {
      throw new AppError(
        502,
        'UPSTREAM_INVALID_RESPONSE',
        'El proveedor externo devolvió una respuesta inválida.'
      )
    }

    if (!data || typeof data !== 'object') {
      throw new AppError(
        502,
        'UPSTREAM_INVALID_RESPONSE',
        'El proveedor externo devolvió un formato inesperado.'
      )
    }

    return data
  }

  return {
    async getSupportedCurrencies() {
      const now = Date.now()
      if (currenciesCache && now < currenciesCacheExpiresAt) {
        return currenciesCache
      }

      const raw = await requestJson('/currencies')
      const list = Object.entries(raw)
        .map(([code, name]) => ({
          code,
          name: String(name),
        }))
        .sort((a, b) => a.code.localeCompare(b.code))

      currenciesCache = list
      currenciesCacheExpiresAt = now + CURRENCY_CACHE_TTL_MS
      return list
    },

    async getLatestRates({ base = 'MXN', symbols = [] } = {}) {
      const filteredSymbols = symbols.filter((s) => s !== base)

      if (symbols.length > 0 && filteredSymbols.length === 0) {
        return {
          base,
          date: new Date().toISOString().slice(0, 10),
          provider: 'Frankfurter (ECB)',
          rates: { [base]: 1 },
        }
      }

      const params = { base }
      if (filteredSymbols.length > 0) {
        params.symbols = filteredSymbols.join(',')
      }

      const data = await requestJson('/latest', params)
      if (!data.rates || typeof data.rates !== 'object') {
        throw new AppError(
          502,
          'UPSTREAM_INVALID_RESPONSE',
          'No se recibieron tasas de cambio válidas del proveedor externo.'
        )
      }

      const rates = { ...data.rates }
      if (symbols.includes(base)) {
        rates[base] = 1
      }

      return {
        base: data.base || base,
        date: data.date || new Date().toISOString().slice(0, 10),
        provider: 'Frankfurter (ECB)',
        rates,
      }
    },

    async convertAmount({ amount, from, to }) {
      if (from === to) {
        return {
          rate: 1,
          convertedAmount: Math.round(amount * 100) / 100,
          rateDate: new Date().toISOString().slice(0, 10),
          provider: 'Frankfurter (ECB)',
        }
      }

      const latest = await this.getLatestRates({ base: from, symbols: [to] })
      const rate = Number(latest.rates?.[to])

      if (!Number.isFinite(rate) || rate <= 0) {
        throw new AppError(
          400,
          'UNSUPPORTED_CURRENCY',
          `No existe tipo de cambio disponible entre ${from} y ${to}.`
        )
      }

      const convertedAmount = Math.round(amount * rate * 100) / 100
      return {
        rate,
        convertedAmount,
        rateDate: latest.date,
        provider: latest.provider,
      }
    },
  }
}

