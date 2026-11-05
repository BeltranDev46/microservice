import crypto from 'node:crypto'

const MAX_ITEMS_PER_USER = 100

export function createConversionStore() {
  const recordsByUser = new Map()

  function getBucket(userId = 'default') {
    if (!recordsByUser.has(userId)) {
      recordsByUser.set(userId, [])
    }
    return recordsByUser.get(userId)
  }

  return {
    create(userId, entry) {
      const bucket = getBucket(userId)
      const record = {
        id: crypto.randomUUID(),
        ...entry,
        createdAt: new Date().toISOString(),
      }
      bucket.unshift(record)
      if (bucket.length > MAX_ITEMS_PER_USER) {
        bucket.length = MAX_ITEMS_PER_USER
      }
      return record
    },

    list(userId, limit = 15) {
      const bucket = getBucket(userId)
      return bucket.slice(0, limit)
    },

    deleteById(userId, id) {
      const bucket = getBucket(userId)
      const index = bucket.findIndex((item) => item.id === id)
      if (index === -1) {
        return false
      }
      bucket.splice(index, 1)
      return true
    },
  }
}

