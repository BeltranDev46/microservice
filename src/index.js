import { createApp } from './app.js'
import { getConfig } from './config/env.js'

const config = getConfig()
const app = createApp()

app.listen(config.port, '0.0.0.0', () => {
  console.log(`🌎 FX Microservice escuchando en puerto ${config.port} (0.0.0.0)`)
  console.log(`   Health check: /api/v1/health`)
  if (!config.microserviceApiKey && !config.jwtSecret) {
    console.warn('⚠️  Configura MICROSERVICE_API_KEY y JWT_SECRET en tus variables de entorno')
  }
})

