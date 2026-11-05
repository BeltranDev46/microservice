export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    code: 'NOT_FOUND',
    error: `El recurso '${req.method} ${req.originalUrl}' no existe en este microservicio.`,
  })
}

export function createErrorHandler({ silent = false } = {}) {
  return function errorHandler(err, _req, res, _next) {
    // Handle malformed JSON payloads sent by clients (400 Bad Request, never expose stack trace)
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({
        code: 'INVALID_JSON',
        error: 'El cuerpo de la petición contiene JSON inválido.',
      })
    }

    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500
    const code = typeof err.code === 'string' && err.code ? err.code : 'INTERNAL_ERROR'

    if (!silent && status >= 500) {
      console.error(`[FX Microservice Error] ${code}: ${err.message}`)
    }

    const payload = {
      code,
      error:
        status >= 500 && !(err instanceof AppError)
          ? 'Ocurrió un error interno en el microservicio de divisas.'
          : err.message || 'No se pudo procesar la solicitud.',
    }

    if (Array.isArray(err.details) && err.details.length > 0) {
      payload.details = err.details
    }

    // Never include err.stack in client responses
    return res.status(status).json(payload)
  }
}

