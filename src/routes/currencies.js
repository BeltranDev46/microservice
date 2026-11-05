import { Router } from 'express'
import { validateRatesQuery } from '../middleware/validate.js'

export function createCurrenciesRouter(exchangeRateClient) {
  const router = Router()

  // GET /api/v1/currencies — Supported ISO 4217 currencies from third-party API
  router.get('/currencies', async (_req, res, next) => {
    try {
      const currencies = await exchangeRateClient.getSupportedCurrencies()
      res.status(200).json({
        count: currencies.length,
        provider: 'Frankfurter (ECB)',
        currencies,
      })
    } catch (err) {
      next(err)
    }
  })

  // GET /api/v1/rates?base=MXN&symbols=USD,EUR — Latest exchange rates with query validation
  router.get('/rates', async (req, res, next) => {
    try {
      const { base, symbols } = validateRatesQuery(req.query)
      const result = await exchangeRateClient.getLatestRates({ base, symbols })
      res.status(200).json(result)
    } catch (err) {
      next(err)
    }
  })

  return router
}

