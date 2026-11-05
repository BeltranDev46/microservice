import { Router } from 'express'
import { AppError } from '../middleware/errorHandler.js'
import {
  validateConversionBody,
  validateListQuery,
  validateUuidParam,
} from '../middleware/validate.js'

export function createConversionsRouter(exchangeRateClient, conversionStore) {
  const router = Router()

  // GET /api/v1/conversions — List saved currency conversions for the caller (Protected)
  router.get('/', (req, res, next) => {
    try {
      const { limit } = validateListQuery(req.query)
      const userId = req.client?.userId || 'default'
      const items = conversionStore.list(userId, limit)

      res.status(200).json({
        count: items.length,
        items,
      })
    } catch (err) {
      next(err)
    }
  })

  // POST /api/v1/conversions — Convert foreign expense amount & store quote (Protected)
  router.post('/', async (req, res, next) => {
    try {
      const { amount, from, to, participants, concept } = validateConversionBody(req.body)
      const fx = await exchangeRateClient.convertAmount({ amount, from, to })

      const perPersonAmount = Math.round((fx.convertedAmount / participants) * 100) / 100
      const userId = req.client?.userId || 'default'

      const created = conversionStore.create(userId, {
        concept: concept || null,
        originalAmount: amount,
        from,
        to,
        rate: fx.rate,
        convertedAmount: fx.convertedAmount,
        participants,
        perPersonAmount,
        rateDate: fx.rateDate,
        provider: fx.provider,
      })

      res
        .status(201)
        .location(`/api/v1/conversions/${created.id}`)
        .json(created)
    } catch (err) {
      next(err)
    }
  })

  // DELETE /api/v1/conversions/:id — Remove a saved conversion quote (Protected)
  router.delete('/:id', (req, res, next) => {
    try {
      const validId = validateUuidParam(req.params.id, 'id')
      const userId = req.client?.userId || 'default'
      const deleted = conversionStore.deleteById(userId, validId)

      if (!deleted) {
        throw new AppError(404, 'CONVERSION_NOT_FOUND', 'La conversión solicitada no fue encontrada.')
      }

      res.status(200).json({
        deleted: true,
        id: validId,
      })
    } catch (err) {
      next(err)
    }
  })

  return router
}

