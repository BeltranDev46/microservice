import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

export function getConfig(overrides = {}) {
  const rawCors = overrides.corsOrigin ?? process.env.CORS_ORIGIN ?? 'http://localhost:3001,http://localhost:5173'
  const corsOrigins = rawCors
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  const timeoutRaw = Number(overrides.externalApiTimeoutMs ?? process.env.EXTERNAL_API_TIMEOUT_MS ?? 6000)

  return {
    port: Number(overrides.port ?? process.env.PORT ?? 4001),
    nodeEnv: overrides.nodeEnv ?? process.env.NODE_ENV ?? 'development',
    corsOrigins,
    microserviceApiKey: (overrides.microserviceApiKey ?? process.env.MICROSERVICE_API_KEY ?? '').trim(),
    jwtSecret: (overrides.jwtSecret ?? process.env.JWT_SECRET ?? '').trim(),
    authClientId: (overrides.authClientId ?? process.env.AUTH_CLIENT_ID ?? '').trim(),
    authClientSecret: (overrides.authClientSecret ?? process.env.AUTH_CLIENT_SECRET ?? '').trim(),
    externalApiBaseUrl: (
      overrides.externalApiBaseUrl ??
      process.env.EXTERNAL_API_BASE_URL ??
      'https://api.frankfurter.dev/v1'
    )
      .trim()
      .replace(/\/+$/, ''),
    externalApiTimeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 6000,
  }
}

