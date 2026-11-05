import crypto from 'node:crypto'
import { jwtVerify } from 'jose'
import { AppError } from './errorHandler.js'

function safeEqualStrings(a, b) {
  if (!a || !b) return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export function createAuthMiddleware(config) {
  return async function requireServiceAuth(req, _res, next) {
    try {
      if (!config.microserviceApiKey && !config.jwtSecret) {
        return next(
          new AppError(
            503,
            'AUTH_NOT_CONFIGURED',
            'El microservicio no tiene configurados los secretos de autenticación en variables de entorno.'
          )
        )
      }

      const authHeader = req.headers.authorization || ''
      const [scheme, token] = authHeader.trim().split(/\s+/)

      if (scheme?.toLowerCase() !== 'bearer' || !token) {
        return next(
          new AppError(
            401,
            'UNAUTHORIZED',
            'Autenticación requerida. Incluye el encabezado Authorization: Bearer <token>.'
          )
        )
      }

      // Option 1: Static service-to-service Bearer API Key
      if (config.microserviceApiKey && safeEqualStrings(token, config.microserviceApiKey)) {
        req.client = {
          sub: 'service-api-key',
          userId: sanitizeUserId(req.headers['x-user-id']),
          authMethod: 'api_key',
        }
        return next()
      }

      // Option 2: Signed HS256 JWT issued by POST /api/v1/auth/token
      if (config.jwtSecret) {
        try {
          const secretKey = new TextEncoder().encode(config.jwtSecret)
          const { payload } = await jwtVerify(token, secretKey, {
            issuer: 'cuentasclaras-fx-microservice',
          })

          req.client = {
            sub: payload.sub || 'jwt-client',
            userId: sanitizeUserId(req.headers['x-user-id'] || payload.sub),
            authMethod: 'jwt',
          }
          return next()
        } catch {
          // Fall through to 401 below
        }
      }

      return next(
        new AppError(401, 'INVALID_TOKEN', 'El token de autenticación es inválido o ha expirado.')
      )
    } catch (err) {
      return next(err)
    }
  }
}

function sanitizeUserId(raw) {
  if (typeof raw !== 'string') return 'default'
  const cleaned = raw.trim().slice(0, 80)
  return cleaned || 'default'
}

