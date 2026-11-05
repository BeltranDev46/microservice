import crypto from 'node:crypto'
import { Router } from 'express'
import { SignJWT } from 'jose'
import { AppError } from '../middleware/errorHandler.js'
import { validateTokenRequestBody } from '../middleware/validate.js'

function safeEqual(a, b) {
  if (!a || !b) return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export function createAuthRouter(config) {
  const router = Router()

  // POST /api/v1/auth/token — Issue a short-lived HS256 JWT for authorized service clients
  router.post('/token', async (req, res, next) => {
    try {
      const { clientId, clientSecret } = validateTokenRequestBody(req.body)

      if (!config.authClientId || !config.authClientSecret || !config.jwtSecret) {
        throw new AppError(
          503,
          'AUTH_NOT_CONFIGURED',
          'Las credenciales OAuth/JWT del microservicio no están configuradas en variables de entorno.'
        )
      }

      const validId = safeEqual(clientId, config.authClientId)
      const validSecret = safeEqual(clientSecret, config.authClientSecret)

      if (!validId || !validSecret) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Credenciales de cliente inválidas.')
      }

      const secretKey = new TextEncoder().encode(config.jwtSecret)
      const expiresIn = 3600

      const accessToken = await new SignJWT({ scope: 'conversions:read conversions:write' })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(clientId)
        .setIssuer('cuentasclaras-fx-microservice')
        .setIssuedAt()
        .setExpirationTime(`${expiresIn}s`)
        .sign(secretKey)

      res.status(200).json({
        accessToken,
        tokenType: 'Bearer',
        expiresIn,
      })
    } catch (err) {
      next(err)
    }
  })

  return router
}

