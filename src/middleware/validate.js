import { AppError } from './errorHandler.js'

const CURRENCY_REGEX = /^[A-Z]{3}$/
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normalizeCurrency(raw) {
  if (typeof raw !== 'string') return ''
  return raw.trim().toUpperCase()
}

export function validateRatesQuery(query = {}) {
  const details = []
  const base = query.base !== undefined ? normalizeCurrency(query.base) : 'MXN'

  if (!CURRENCY_REGEX.test(base)) {
    details.push({
      field: 'base',
      message: 'El parámetro "base" debe ser un código de moneda ISO 4217 de 3 letras (ej. MXN, USD, EUR).',
    })
  }

  let symbols = []
  if (query.symbols !== undefined && String(query.symbols).trim() !== '') {
    if (typeof query.symbols !== 'string') {
      details.push({
        field: 'symbols',
        message: 'El parámetro "symbols" debe ser una lista separada por comas de códigos de 3 letras (ej. USD,EUR).',
      })
    } else {
      symbols = query.symbols
        .split(',')
        .map((s) => normalizeCurrency(s))
        .filter(Boolean)

      const invalidSymbols = symbols.filter((s) => !CURRENCY_REGEX.test(s))
      if (symbols.length === 0 || invalidSymbols.length > 0) {
        details.push({
          field: 'symbols',
          message: `Códigos de moneda inválidos en "symbols": ${invalidSymbols.join(', ') || query.symbols}. Usa códigos ISO de 3 letras.`,
        })
      }
    }
  }

  if (details.length > 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Parámetros de consulta inválidos.', details)
  }

  return { base, symbols }
}

export function validateConversionBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Se requiere un objeto JSON en el cuerpo de la petición.')
  }

  const details = []

  const rawAmount = body.amount
  const numericAmount =
    typeof rawAmount === 'number'
      ? rawAmount
      : typeof rawAmount === 'string' && rawAmount.trim() !== ''
      ? Number(rawAmount)
      : NaN

  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 100_000_000) {
    details.push({
      field: 'amount',
      message: 'El campo "amount" es obligatorio y debe ser un número mayor a 0 y menor o igual a 100,000,000.',
    })
  }

  const from = normalizeCurrency(body.from)
  if (!CURRENCY_REGEX.test(from)) {
    details.push({
      field: 'from',
      message: 'El campo "from" es obligatorio y debe ser un código ISO 4217 de 3 letras (ej. USD, EUR).',
    })
  }

  const to = body.to !== undefined ? normalizeCurrency(body.to) : 'MXN'
  if (!CURRENCY_REGEX.test(to)) {
    details.push({
      field: 'to',
      message: 'El campo "to" debe ser un código ISO 4217 de 3 letras (ej. MXN, USD).',
    })
  }

  let participants = 1
  if (body.participants !== undefined && body.participants !== null && body.participants !== '') {
    const parsedParticipants = Number(body.participants)
    if (!Number.isInteger(parsedParticipants) || parsedParticipants < 1 || parsedParticipants > 100) {
      details.push({
        field: 'participants',
        message: 'El campo "participants" debe ser un número entero entre 1 y 100.',
      })
    } else {
      participants = parsedParticipants
    }
  }

  let concept = ''
  if (body.concept !== undefined && body.concept !== null) {
    if (typeof body.concept !== 'string') {
      details.push({
        field: 'concept',
        message: 'El campo "concept" debe ser una cadena de texto.',
      })
    } else if (body.concept.trim().length > 120) {
      details.push({
        field: 'concept',
        message: 'El campo "concept" no puede exceder 120 caracteres.',
      })
    } else {
      concept = body.concept.trim()
    }
  }

  if (details.length > 0) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      details[0].message,
      details
    )
  }

  return {
    amount: Math.round(numericAmount * 100) / 100,
    from,
    to,
    participants,
    concept,
  }
}

export function validateListQuery(query = {}) {
  if (query.limit === undefined || query.limit === '') {
    return { limit: 15 }
  }

  const parsed = Number(query.limit)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new AppError(400, 'VALIDATION_ERROR', 'El parámetro "limit" debe ser un entero entre 1 y 50.', [
      { field: 'limit', message: 'Debe ser un número entero entre 1 y 50.' },
    ])
  }

  return { limit: parsed }
}

export function validateUuidParam(id, paramName = 'id') {
  if (typeof id !== 'string' || !UUID_REGEX.test(id.trim())) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `El parámetro "${paramName}" no tiene un formato UUID válido.`,
      [{ field: paramName, message: 'Formato UUID requerido.' }]
    )
  }
  return id.trim()
}

export function validateTokenRequestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Se requiere un objeto JSON con clientId y clientSecret.')
  }

  const details = []
  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
  const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : ''

  if (!clientId) {
    details.push({ field: 'clientId', message: 'El campo "clientId" es obligatorio.' })
  }
  if (!clientSecret) {
    details.push({ field: 'clientSecret', message: 'El campo "clientSecret" es obligatorio.' })
  }

  if (details.length > 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Credenciales de cliente incompletas.', details)
  }

  return { clientId, clientSecret }
}

