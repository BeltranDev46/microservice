import express from 'express'
import cors from 'cors'
import { getConfig } from './config/env.js'
import { createAuthMiddleware } from './middleware/requireServiceAuth.js'
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { createExchangeRateClient } from './services/exchangeRateClient.js'
import { createConversionStore } from './services/conversionStore.js'
import { createAuthRouter } from './routes/auth.js'
import { createCurrenciesRouter } from './routes/currencies.js'
import { createConversionsRouter } from './routes/conversions.js'

export function createApp({
  configOverrides = {},
  fetchImpl = globalThis.fetch,
  silentErrors = false,
} = {}) {
  const config = getConfig(configOverrides)
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
          return callback(null, true)
        }
        return callback(null, false)
      },
      credentials: true,
    })
  )

  app.use(express.json({ limit: '64kb' }))

  const exchangeRateClient = createExchangeRateClient(config, { fetchImpl })
  const conversionStore = createConversionStore()
  const requireServiceAuth = createAuthMiddleware(config)

  // Root info endpoint (handy when opening Render URL in browser)
  app.get('/', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'cuentasclaras-fx-microservice',
      healthEndpoint: '/api/v1/health',
    })
  })

  // Public health endpoint
  app.get('/api/v1/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'cuentasclaras-fx-microservice',
      version: '1.0.0',
      upstreamProvider: 'Frankfurter (ECB)',
      timestamp: new Date().toISOString(),
    })
  })

  // Auth token endpoint (exchanges client credentials for signed JWT)
  app.use('/api/v1/auth', createAuthRouter(config))

  // Public exchange-rate & currency catalog endpoints
  app.use('/api/v1', createCurrenciesRouter(exchangeRateClient))

  // Protected conversion endpoints (require Bearer JWT or Service API Key)
  app.use(
    '/api/v1/conversions',
    requireServiceAuth,
    createConversionsRouter(exchangeRateClient, conversionStore)
  )

  // 404 & global error handlers (never leak stack traces)
  app.use(notFoundHandler)
  app.use(createErrorHandler({ silent: silentErrors }))

  return app
}

